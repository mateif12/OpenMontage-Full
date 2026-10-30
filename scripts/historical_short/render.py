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
    python scripts/historical_short/render.py --project projects/<ep> --preview   # review stills (fast)
    python scripts/historical_short/render.py --project projects/<ep>             # final, once
    --preview renders 2 stills per scene (one bundle, one browser) into
              renders/preview/ plus renders/preview_sheet.jpg — review THIS,
              fix, re-run; only render the final when the stills are right.
    --times   explicit still times for --preview (comma separated seconds).
    --draft   (legacy) half-scale video; slower than --preview for review.
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


def preview(project: Path, props_path: Path, times: list[float] | None, scale: float) -> int:
    import os
    import shutil
    import time as _t
    props = json.loads(props_path.read_text())
    if not times:
        times = []
        for sc in props["scenes"]:
            d = sc["end"] - sc["start"]
            times += [round(sc["start"] + d * 0.35, 2), round(sc["start"] + d * 0.85, 2)]
    out_dir = project / "renders" / "preview"
    shutil.rmtree(out_dir, ignore_errors=True)
    if CHROMIUM.exists():
        os.environ.setdefault("REMOTION_BROWSER_EXECUTABLE", str(CHROMIUM))
    t0 = _t.time()
    subprocess.run(["node", str(Path(__file__).with_name("preview_stills.mjs")), str(props_path),
                    str(project / "assets"), str(out_dir), str(scale), ",".join(map(str, times))],
                   check=True, cwd=REPO / "remotion-composer")
    sheet = project / "renders" / "preview_sheet.jpg"
    _tile(sorted(out_dir.glob("t*.jpg")), props, sheet)
    print(f"{len(times)} stills in {_t.time() - t0:.0f}s -> {sheet}")
    return 0


def _tile(paths: list[Path], props: dict, out: Path, cols: int = 8) -> None:
    from PIL import Image, ImageDraw
    if not paths:
        return
    w, h = 216, 384
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + 6), rows * (h + 26)), "black")
    draw = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        t = float(p.stem[1:])
        sid = next((s["id"] for s in props["scenes"] if s["start"] <= t < s["end"] + 1e-6), "")
        im = Image.open(p).convert("RGB").resize((w, h))
        x, y = (i % cols) * (w + 6), (i // cols) * (h + 26)
        sheet.paste(im, (x, y + 22))
        draw.text((x + 2, y + 4), f"{t:.1f}s {sid}"[:34], fill="white")
    sheet.save(out, quality=88)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--times", help="comma-separated seconds for --preview")
    ap.add_argument("--scale", type=float, default=0.5, help="--preview still scale")
    ap.add_argument("--concurrency", type=int, default=0, help="render workers (default: all CPUs)")
    ap.add_argument("--output")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    props = project / "artifacts" / "props.json"
    if not props.exists():
        sys.exit(f"missing {props} — run build_props.py first")
    if args.preview:
        times = [float(x) for x in args.times.split(",")] if args.times else None
        return preview(project, props, times, args.scale)
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
            # measured 2026-10-30 (4 vCPU): 4 workers ≈12% faster than Remotion's default 2
            "concurrency": args.concurrency or (__import__("os").cpu_count() or 2),
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
