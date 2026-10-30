#!/usr/bin/env python3
"""Render a historical Short through video_compose and verify the output.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Routes through OpenMontage's own `video_compose` tool (render_runtime =
"remotion", custom-composition path via edit_decisions.bespoke) with the
HistoricalShort entry at remotion-composer/src/historical-short/entry.tsx.
After rendering it checks resolution, frame rate, duration vs. the narration,
audio presence, and writes a frame contact sheet for review.

Usage:
    python scripts/historical_short/render.py --project projects/<ep> [--draft]
    --draft renders at half scale with a faster encode for review.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

ENTRY = REPO / "remotion-composer" / "src" / "historical-short" / "entry.tsx"
CHROMIUM = Path("/opt/pw-browsers/chromium")


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def contact_sheet(video: Path, out: Path, every: float = 2.5) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(video),
         "-vf", f"fps=1/{every},scale=270:-1,tile=7x3:padding=6:color=black", "-frames:v", "1", str(out)],
        check=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--output")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    props = project / "artifacts" / "props.json"
    if not props.exists():
        sys.exit(f"missing {props} — run build_props.py first")
    expected = json.loads(props.read_text())["durationSeconds"]
    out = Path(args.output) if args.output else project / "renders" / ("draft.mp4" if args.draft else "final.mp4")

    from tools.video.video_compose import VideoCompose  # noqa: E402

    edit_decisions = {
        "render_runtime": "remotion",
        "composition_mode": "atelier",  # = custom composition entry (see historical-short.md)
        "bespoke": {
            "entry": str(ENTRY),
            "composition_id": "HistoricalShort",
            "props_path": str(props),
            "public_dir": str(project / "assets"),
            "art_direction": "historical-short profile: dark parchment/gold documentary palette, "
                             "Playfair Display + Space Grotesk, slow camera-only moves on authentic stills, "
                             "original Natural Earth maps and schematic diagram",
            "crf": 23 if args.draft else 16,
            **({"scale": 0.5} if args.draft else {}),
        },
    }
    if CHROMIUM.exists():
        import os
        os.environ.setdefault("REMOTION_BROWSER_EXECUTABLE", str(CHROMIUM))

    result = VideoCompose().execute({"operation": "render", "edit_decisions": edit_decisions,
                                     "output_path": str(out)})
    if not result.success:
        print(f"RENDER FAILED: {result.error}", file=sys.stderr)
        return 2

    info = ffprobe(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = [s for s in info["streams"] if s["codec_type"] == "audio"]
    dur = float(info["format"]["duration"])
    want_w, want_h = (540, 960) if args.draft else (1080, 1920)
    checks = {
        "resolution": f"{v['width']}x{v['height']}",
        "resolution_ok": (v["width"], v["height"]) == (want_w, want_h),
        "fps": v["r_frame_rate"],
        "fps_ok": v["r_frame_rate"] == "30/1",
        "duration": round(dur, 3),
        "narration_duration": expected,
        "duration_ok": abs(dur - expected) <= 0.1,
        "audio_ok": bool(a),
        "video_codec": v["codec_name"],
        "final_review_status": (result.data or {}).get("final_review_status"),
    }
    # loudness / clipping and blank-frame checks
    ebu = subprocess.run(["ffmpeg", "-nostats", "-i", str(out), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    import re as _re
    summ = ebu[ebu.rfind("Summary:"):]
    li = _re.search(r"I:\s+(-?[\d.]+) LUFS", summ)
    tp = _re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ)
    checks["integrated_lufs"] = float(li.group(1)) if li else None
    checks["true_peak_dbfs"] = float(tp.group(1)) if tp else None
    checks["audio_not_clipped"] = bool(tp) and float(tp.group(1)) <= -1.0
    blk = subprocess.run(["ffmpeg", "-i", str(out), "-vf", "blackdetect=d=0.5:pix_th=0.05", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    checks["black_segments_over_0_5s"] = blk.count("black_start")
    sheet = out.with_name(out.stem + "_contact.jpg")
    contact_sheet(out, sheet)
    report = {"output": str(out), "contact_sheet": str(sheet), "checks": checks}
    (project / "artifacts" / f"render_report_{out.stem}.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    ok = all(checks[k] for k in ("resolution_ok", "fps_ok", "duration_ok", "audio_ok", "audio_not_clipped")) \
        and checks["black_segments_over_0_5s"] == 0
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
