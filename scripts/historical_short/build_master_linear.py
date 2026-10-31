#!/usr/bin/env python3
"""Build the narration master with ONE fixed linear gain (+ transparent peak limiter).

Part of the historical-short workflow. Alternative to new_episode.py's
loudnorm master for narrations that must be preserved as exactly as possible:
ffmpeg's loudnorm silently switches to *dynamic* gain riding when the linear
gain needed to reach the target would push true peaks over the ceiling. This
script instead applies a single constant gain (target integrated loudness
minus measured loudness) and a fast look-ahead limiter that only touches the
few transients above the ceiling, then adds the silent lead-in / tail.

Usage:
    python scripts/historical_short/build_master_linear.py --src narration_source.mp3 \
        --out narration_master.wav --lead 3.0 --tail 7.0 [--target -16] [--ceiling -2.0] [--release 20]
Prints a JSON report: measured loudness, applied gain, share of samples limited,
result loudness / true peak, and correlation with the source (identity check).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess

import numpy as np


def ebur128(path: str) -> dict:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    summ = err[err.rfind("Summary:"):]
    return {"integrated_lufs": float(re.search(r"I:\s+(-?[\d.]+) LUFS", summ).group(1)),
            "true_peak_dbtp": float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ).group(1))}


def pcm(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lead", type=float, default=0.5)
    ap.add_argument("--tail", type=float, default=1.2)
    ap.add_argument("--target", type=float, default=-16.0, help="integrated loudness target (LUFS)")
    ap.add_argument("--ceiling", type=float, default=-2.0, help="limiter ceiling (dBFS sample peak)")
    ap.add_argument("--release", type=float, default=20.0, help="limiter release (ms)")
    args = ap.parse_args()

    before = ebur128(args.src)
    gain = round(args.target - before["integrated_lufs"], 2)
    lim = 10 ** (args.ceiling / 20)
    flt = (f"aresample=48000,volume={gain}dB,"
           f"alimiter=limit={lim:.4f}:attack=1:release={args.release:g}:level=false:latency=true,"
           f"adelay={int(args.lead * 1000)}:all=1,apad=pad_dur={args.tail}")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", args.src, "-af", flt, "-ar", "48000", "-ac", "1", args.out],
                   check=True)
    after = ebur128(args.out)

    src = pcm(args.src)
    out = pcm(args.out)
    lead = int(round(args.lead * 48000))
    seg = out[lead:lead + len(src)]
    corr = float(np.dot(src, seg) / np.sqrt(np.dot(src, src) * np.dot(seg, seg)))
    g = 10 ** (gain / 20)
    limited = float(np.mean(np.abs(src) * g > lim))
    report = {"source": before, "gain_db": gain, "limiter_ceiling_dbfs": args.ceiling,
              "share_of_samples_above_ceiling_before_limiting": round(limited, 5),
              "result": after, "correlation_with_source": round(corr, 5),
              "duration_s": round(len(out) / 48000, 3)}
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
