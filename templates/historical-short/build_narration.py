"""Narration for a historical Short: Piper TTS, timeline layout, captions.

Reads artifacts/narration_segments.json:
  [{"id": "s0a", "caption": "June sixth, 1944.", "spoken": "June sixth, 1944."}, ...]
("spoken" may differ from "caption" to respell a word the voice gets wrong)
and artifacts/short_config.json (voice, narration_timing, whisper_model).

Writes assets/audio/narration.wav, artifacts/narration_layout.json and
artifacts/caption_words.json (Whisper word timings mapped onto the caption
text). Then prints every word Whisper heard differently from the script:
anything other than number formatting means the voice mispronounced it,
so respell that word in "spoken" and run again.

Usage: .venv/bin/python templates/historical-short/build_narration.py <project>
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # plain HTTPS model download
os.environ["PATH"] = f"{ROOT / '.venv' / 'bin'}{os.pathsep}{os.environ['PATH']}"

from tools.audio.piper_tts import PiperTTS  # noqa: E402

TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse")


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout)


def loudness(path: Path) -> tuple[float, float]:
    err = subprocess.run(["ffmpeg", "-nostdin", "-i", str(path), "-af", "ebur128=peak=true",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = err.split("Summary:")[-1]
    lufs = float(summary.split("I:")[1].split("LUFS")[0])
    peak = float(summary.split("Peak:")[1].split("dBFS")[0])
    return lufs, peak


def main(project: Path) -> None:
    cfg = json.loads((project / "artifacts" / "short_config.json").read_text())
    segs = json.loads((project / "artifacts" / "narration_segments.json").read_text())
    voice, timing = cfg["voice"], cfg["narration_timing"]
    audio = project / "assets" / "audio"
    (audio / "segments").mkdir(parents=True, exist_ok=True)

    tts = PiperTTS()
    t = timing["lead_in_seconds"]
    layout, inputs, filters = [], [], []
    for i, seg in enumerate(segs):
        raw = audio / "segments" / f"{seg['id']}.wav"
        trimmed = audio / "segments" / f"{seg['id']}_trim.wav"
        r = tts.execute({"text": seg["spoken"], "model": os.path.expanduser(voice["model"]),
                         "length_scale": voice["length_scale"],
                         "sentence_silence": voice["sentence_silence"], "output_path": str(raw)})
        if not r.success:
            raise SystemExit(f"{seg['id']}: {r.error}")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(raw), "-af", TRIM,
                        str(trimmed)], check=True)
        d = duration(trimmed)
        layout.append({**seg, "start": round(t, 3), "end": round(t + d, 3)})
        inputs += ["-i", str(trimmed)]
        filters.append(f"[{i}:a]adelay={int(round(t * 1000))}:all=1[a{i}]")
        t += d + timing["gap_after"].get(seg["id"], timing["default_gap_seconds"])
    # The last gap is replaced by the tail.
    last_gap = timing["gap_after"].get(segs[-1]["id"], timing["default_gap_seconds"])
    total = round(t - last_gap + timing["tail_seconds"], 2)

    mix = "".join(f"[a{i}]" for i in range(len(segs)))
    mix += f"amix=inputs={len(segs)}:normalize=0,apad=whole_dur={total},atrim=0:{total}[out]"
    raw_mix = audio / "narration_raw.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *inputs, "-filter_complex",
                    ";".join(filters) + ";" + mix, "-map", "[out]", "-ar", "48000", "-ac", "2",
                    str(raw_mix)], check=True)
    lufs, _ = loudness(raw_mix)
    gain = round(timing["target_lufs"] - lufs, 2)
    final = audio / "narration.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(raw_mix), "-af",
                    f"volume={gain}dB,alimiter=limit={timing['limiter_ceiling']}:attack=5:"
                    "release=50:level=disabled", str(final)], check=True)
    lufs2, peak = loudness(final)

    (project / "artifacts" / "narration_layout.json").write_text(json.dumps({
        "total_seconds": total, "gain_db": gain, "integrated_lufs": lufs2,
        "true_peak_dbfs": peak, "voice": voice["name"], "length_scale": voice["length_scale"],
        "segments": layout}, indent=1))
    print(f"narration: {total}s, {lufs2} LUFS, true peak {peak} dBFS")

    from faster_whisper import WhisperModel

    model = WhisperModel(cfg.get("whisper_model", "small.en"), device="cpu", compute_type="int8")
    result, _ = model.transcribe(str(final), language="en", beam_size=5, word_timestamps=True)
    heard = []
    for s in result:
        for w in s.words:
            text = w.word.strip()
            if heard and text.startswith("-"):  # Whisper splits "Nazi -occupied"
                heard[-1] = (heard[-1][0] + text, heard[-1][1], w.end)
            else:
                heard.append((text, w.start, w.end))
    tokens = [(seg["id"], tok, i == len(seg["caption"].split()) - 1)
              for seg in layout for i, tok in enumerate(seg["caption"].split())]
    if len(tokens) != len(heard):
        raise SystemExit(f"Whisper heard {len(heard)} words for {len(tokens)} script words: "
                         + " ".join(h[0] for h in heard))

    def norm(x):
        return re.sub(r"\W", "", x.lower())

    words, mismatches = [], []
    for (sid, tok, last), (h, a, b) in zip(tokens, heard):
        if norm(tok) != norm(h):
            mismatches.append((tok, h))
        words.append({"word": tok, "startMs": int(round(a * 1000)), "endMs": int(round(b * 1000)),
                      "heard": h, "segment": sid,
                      "pageBreakAfter": bool(re.search(r"[.,!?;:]$", tok)) or last})
    (project / "artifacts" / "caption_words.json").write_text(json.dumps(words, indent=1))
    print("script vs heard mismatches (check pronunciation):", mismatches or "none")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
