#!/usr/bin/env python3
"""Group word-level captions into broadcast-style subtitle cues + SRT.

Part of the historical-short workflow (landscape documentary variant, see
skills/pipelines/documentary-montage/historical-short.md).

Input is artifacts/captions.json from align_captions.py (narration words with
Whisper start/end times on the master clock). Output:
  * artifacts/subtitle_cues.json  — cues rendered by the HistoricalDocumentary
    composition (build_props.py picks them up automatically)
  * <out-srt>                     — the same cues as an .srt sidecar

Rules: a cue never spans two sentences; max 2 lines of <= --max-line chars;
long sentences split at the comma closest to the middle (else the middle word);
a cue starts 0.05 s before its first word and holds up to 0.6 s after its last
word, never overlapping the next cue; minimum on-screen time 1.0 s where the
gap allows. Reading speed (chars/s) is reported for review.

Usage:
    python scripts/historical_short/build_subtitles.py --project projects/<id> [--max-line 42]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def silences(audio: Path, noise_db: float = -38.0, min_dur: float = 0.25) -> list[tuple[float, float]]:
    """Silent intervals of the narration (ffmpeg silencedetect)."""
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(audio), "-af",
                          f"silencedetect=n={noise_db}dB:d={min_dur}", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", err)]
    en = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", err)]
    return list(zip(st, en))


def wrap(text: str, max_line: int) -> list[str]:
    if len(text) <= max_line:
        return [text]
    words = text.split()
    best = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        if len(a) <= max_line and len(b) <= max_line:
            score = abs(len(a) - len(b)) - (6 if a.endswith(",") else 0)
            if best is None or score < best[0]:
                best = (score, [a, b])
    return best[1] if best else [text]


def split_sentence(words: list[dict], max_chars: int) -> list[list[dict]]:
    text = " ".join(w["word"] for w in words)
    if len(text) <= max_chars:
        return [words]
    mid = len(text) / 2
    pos, cands = 0, []
    for i, w in enumerate(words[:-1]):
        pos += len(w["word"]) + 1
        cands.append((abs(pos - mid) - (25 if w["word"].endswith(",") else 0), i))
    _, cut = min(cands)
    return split_sentence(words[: cut + 1], max_chars) + split_sentence(words[cut + 1:], max_chars)


def ts(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--max-line", type=int, default=42)
    ap.add_argument("--out-srt", help="default: <project>/assets/subtitles.srt")
    ap.add_argument("--audio", help="narration master used to snap cue starts to speech onsets "
                                    "(default: <project>/assets/audio/narration_master.wav)")
    args = ap.parse_args()

    project = Path(args.project)
    words = json.loads((project / "artifacts" / "captions.json").read_text())["words"]

    sentences, cur = [], []
    for w in words:
        cur.append(w)
        if w["word"].endswith((".", "!", "?")) or w is words[-1]:
            sentences.append(cur)
            cur = []
    groups = []
    for s in sentences:
        groups += split_sentence(s, args.max_line * 2)

    audio = Path(args.audio) if args.audio else project / "assets" / "audio" / "narration_master.wav"
    gaps = silences(audio) if audio.exists() else []

    def snap(t: float) -> float:
        # recogniser word starts can land inside a pause: move them to the speech onset
        for a, b in gaps:
            if a - 0.1 <= t < b:
                return b - 0.03
        return t

    cues = []
    prev_last = 0.0
    for g in groups:
        text = " ".join(w["word"] for w in g)
        raw = g[0]["startMs"] / 1000
        snapped = snap(raw)
        start = max(raw - 0.05 if snapped == raw else snapped, prev_last)
        prev_last = g[-1]["endMs"] / 1000
        cues.append({"start": start, "last": prev_last, "text": text})
    for i, c in enumerate(cues):
        nxt = cues[i + 1]["start"] if i + 1 < len(cues) else c["last"] + 1.0
        end = min(nxt - 0.04, max(c["last"] + 0.6, c["start"] + 1.0))
        c["end"] = round(max(end, c["last"]), 3)
        c["start"] = round(max(0.0, c["start"]), 3)
        c["lines"] = wrap(c["text"], args.max_line)

    out = [{"start": c["start"], "end": c["end"], "lines": c["lines"]} for c in cues]
    (project / "artifacts" / "subtitle_cues.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    srt = project / "assets" / "subtitles.srt" if not args.out_srt else Path(args.out_srt)
    srt.write_text("".join(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n" + "\n".join(c["lines"]) + "\n\n"
                           for i, c in enumerate(out, 1)), encoding="utf-8")
    worst = 0.0
    for c in out:
        cps = sum(len(l) for l in c["lines"]) / max(0.01, c["end"] - c["start"])
        worst = max(worst, cps)
        print(f"{c['start']:6.2f}-{c['end']:6.2f} ({cps:4.1f} cps)  " + " / ".join(c["lines"]))
    print(f"{len(out)} cues, max reading speed {worst:.1f} chars/s, wrote {srt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
