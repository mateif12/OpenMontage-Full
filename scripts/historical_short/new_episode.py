#!/usr/bin/env python3
"""ENTRY POINT — set up a new historical Short from an MP3 and a topic.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md — read it first).

What it does, in order (all local and free):
  1. creates projects/<id>/ (OpenMontage workspace, pipeline documentary-montage)
  2. copies the MP3 and records its technical properties
  3. builds the audio master: two-pass EBU R128 loudness normalisation
     (-16 LUFS integrated, -1.5 dBTP) + short silent lead-in and tail so the
     video can open and close with a fade
  4. transcribes the master locally (faster-whisper via tools/analysis/transcriber)
  5. writes word-level captions + SRT from the transcript (or from a script,
     if one is supplied with --script)
  6. generates the optional original ambience bed
  7. writes artifacts/episode_brief.json — the facts the agent needs next
  8. writes the scene-plan skeleton projects/<id>/episode.yaml (plan_scenes.py:
     cuts in the pauses, detected period, combat tags, asset-pack candidates)
     (duration, sentence timings, transcript text) for research + scene planning

Usage:
    python scripts/historical_short/new_episode.py \
        --mp3 /path/to/narration.mp3 --topic "The Battle of Cannae (216 BC)" [--id battle-of-cannae]
        [--script script.txt] [--no-ambience] [--lead 0.5] [--tail 1.2]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
HERE = Path(__file__).resolve().parent

TARGET_I = -16.0
TARGET_TP = -1.5
TARGET_LRA = 11.0


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw)


def probe(path: Path) -> dict:
    out = run(["ffprobe", "-v", "error", "-show_entries",
               "stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate",
               "-of", "json", str(path)]).stdout
    return json.loads(out)


def measure_loudness(path: Path, extra: str = "") -> dict:
    flt = f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json"
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", flt, "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])


def build_master(src: Path, dst: Path, lead: float, tail: float) -> dict:
    m = measure_loudness(src)
    flt = (
        f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
        f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
        f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
        f"aresample=48000,adelay={int(lead * 1000)}:all=1,apad=pad_dur={tail}"
    )
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", flt, "-ar", "48000", "-ac", "1", str(dst)])
    after = measure_loudness(dst)
    return {"before": {k: m[k] for k in ("input_i", "input_tp", "input_lra")},
            "after": {"integrated_lufs": after["input_i"], "true_peak_dbtp": after["input_tp"],
                      "lra": after["input_lra"]}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mp3", required=True)
    ap.add_argument("--topic", required=True)
    ap.add_argument("--id")
    ap.add_argument("--script", help="optional exact script; otherwise the transcript is the caption source")
    ap.add_argument("--lead", type=float, default=0.5, help="silent seconds before the narration")
    ap.add_argument("--tail", type=float, default=1.2, help="silent seconds after the narration")
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument("--no-ambience", action="store_true")
    args = ap.parse_args()

    os.chdir(REPO)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")  # Xet CDN is often blocked in sandboxes
    ep_id = args.id or slug(args.topic)
    project = REPO / "projects" / ep_id

    from lib.checkpoint import init_project
    if not (project / "project.json").exists():
        init_project(ep_id, title=args.topic, pipeline_type="documentary-montage")
    audio = project / "assets" / "audio"
    arts = project / "artifacts"
    audio.mkdir(parents=True, exist_ok=True)
    arts.mkdir(parents=True, exist_ok=True)

    src = audio / "narration_source.mp3"
    if Path(args.mp3).resolve() != src.resolve():
        shutil.copy2(args.mp3, src)
    src_info = probe(src)
    print(f"[1/6] MP3: {float(src_info['format']['duration']):.3f}s, "
          f"{src_info['streams'][0]['codec_name']} {src_info['streams'][0]['sample_rate']} Hz")

    master = audio / "narration_master.wav"
    loud = build_master(src, master, args.lead, args.tail)
    duration = float(probe(master)["format"]["duration"])
    print(f"[2/6] audio master: {duration:.3f}s, {loud['after']}")

    from tools.analysis.transcriber import Transcriber
    r = Transcriber().execute({"input_path": str(master), "model_size": args.whisper_model,
                               "language": "en", "output_dir": str(arts)})
    if not r.success:
        print(f"TRANSCRIPTION FAILED: {r.error}\nAsk the user for the script text.", file=sys.stderr)
        return 2
    (arts / "transcript_raw.json").write_text(json.dumps(r.data, indent=1))
    transcript_text = " ".join(s["text"].strip() for s in r.data["segments"])
    (arts / "transcript.txt").write_text(transcript_text + "\n")
    print(f"[3/6] transcript: {len(r.data['word_timestamps'])} words")

    script = Path(args.script) if args.script else arts / "transcript.txt"
    if args.script:
        shutil.copy2(script, arts / "script.txt")
    run([sys.executable, str(HERE / "align_captions.py"), "--script", str(script),
         "--transcript", str(arts / "transcript_raw.json"), "--out", str(arts / "captions.json")])
    captions = json.loads((arts / "captions.json").read_text())
    print(f"[4/6] captions: {captions['report']}")

    if not args.no_ambience:
        run([sys.executable, str(HERE / "make_ambience.py"), "--duration", f"{duration:.3f}",
             "--out", str(audio / "ambience.wav")])
        print("[5/6] ambience bed written")

    brief = {
        "id": ep_id,
        "topic": args.topic,
        "project_dir": str(project.relative_to(REPO)),
        "narration_master": "audio/narration_master.wav",
        "duration_seconds": round(duration, 3),
        "lead_seconds": args.lead,
        "tail_seconds": args.tail,
        "source_mp3": {"duration": float(src_info["format"]["duration"]), **src_info["streams"][0]},
        "loudness": loud,
        "caption_source": "script" if args.script else "transcript",
        "sentences": [{"start": round(s["startMs"] / 1000, 2), "end": round(s["endMs"] / 1000, 2),
                       "text": s["text"]} for s in captions["sentences"]],
        "transcript": transcript_text,
        "next_steps": [
            "Read transcript.txt; fix obvious recogniser errors in proper nouns ONLY if certain "
            "(edit artifacts/script.txt and re-run align_captions.py with --script).",
            "Fact-check every claim (historical-short.md §3).",
            "Complete the scene-plan skeleton projects/<id>/episode.yaml (written by plan_scenes.py: "
            "cuts, period, combat tags, pack candidates); see historical-short.md §3.",
            "fetch_commons.py fetch-list (pack ids first), build_props.py, render.py --preview, "
            "then ONE final render.py.",
        ],
    }
    (arts / "episode_brief.json").write_text(json.dumps(brief, indent=1, ensure_ascii=False))
    print(f"[6/6] wrote {arts / 'episode_brief.json'}")
    print(run([sys.executable, str(HERE / "plan_scenes.py"), "--project", str(project),
               "--topic", args.topic]).stdout.strip())
    print("\nSENTENCES:")
    for s in brief["sentences"]:
        print(f"  {s['start']:6.2f}-{s['end']:6.2f}  {s['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
