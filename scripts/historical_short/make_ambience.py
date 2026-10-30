#!/usr/bin/env python3
"""Synthesise a very subtle, original wind/room-tone bed with FFmpeg.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Generated from filtered brown noise — no samples, no third-party audio, so
there are no rights to clear. Mixed far under the narration (the composition
plays it at ambience.volume, default 0.05).

Usage:
    python scripts/historical_short/make_ambience.py --duration 51.15 \
        --out projects/<ep>/assets/audio/ambience.wav
"""

from __future__ import annotations

import argparse
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=216)
    args = ap.parse_args()
    d = args.duration
    fade_out_start = max(0.0, d - 2.5)
    # brown noise -> band-limit to a low "wind" rumble -> slow swells (two
    # incommensurate sine LFOs, ~14 s and ~23 s periods) -> fades.
    filt = (
        f"lowpass=f=520,highpass=f=70,"
        f"volume='0.55+0.25*sin(2*PI*t/14)+0.15*sin(2*PI*t/23+1)':eval=frame,"
        f"afade=t=in:st=0:d=2.0,afade=t=out:st={fade_out_start:.2f}:d=2.5,"
        f"aformat=channel_layouts=stereo"
    )
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", f"anoisesrc=color=brown:amplitude=0.6:seed={args.seed}:duration={d:.3f}:sample_rate=48000",
        "-af", filt,
        "-ar", "48000", args.out,
    ]
    subprocess.run(cmd, check=True)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
