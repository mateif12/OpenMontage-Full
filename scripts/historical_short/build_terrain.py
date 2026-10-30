#!/usr/bin/env python3
"""Shaded-relief terrain for battlefield-scale maps (free Copernicus DEM).

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Natural Earth (build_basemap.py) is fine for continents but blank at
battlefield scale. This draws the actual ground — ridges, valleys, slopes —
from the Copernicus GLO-30 digital elevation model (30 m), read anonymously
from the AWS Open Data bucket (copernicus-dem-30m.s3.amazonaws.com, ~32 MB per
1°×1° tile, cached in ~/.cache/openmontage/dem).

Licence: Copernicus DEM GLO-30 is free to use, including commercially, with
attribution: "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and
ESA". build_props.py adds it to CREDITS.txt when a map uses terrain.

Caveat: GLO-30 is a modern surface model (trees and buildings included); it is
smoothed here and shows today's landforms — the map note should say
"modern terrain".

Output: <out>.png (RGB relief tinted with the map palette) + <out>.json
{"src", "bbox": [W,S,E,N]} — reference it from a map scene as
``terrain: maps/<name>.json``.

Usage:
    python scripts/historical_short/build_terrain.py --bbox 4.30 50.62 4.52 50.74 \
        --out projects/<ep>/assets/maps/terrain_field [--exaggeration 4]
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

CACHE = Path.home() / ".cache" / "openmontage" / "dem"
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
ATTRIBUTION = ("Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, "
               "provided under COPERNICUS by the European Union and ESA")
LAND = (59, 51, 38)       # theme.ts palette.land  #3b3326
HIGHLIGHT = (156, 134, 87)  # palette.landEdge     #9c8657


def tile_name(lat: int, lon: int) -> str:
    ns = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
    ew = f"E{lon:03d}" if lon >= 0 else f"W{-lon:03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def fetch_tile(lat: int, lon: int) -> Path | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    name = tile_name(lat, lon)
    dest = CACHE / f"{name}.tif"
    if dest.exists():
        return dest
    r = subprocess.run(["curl", "-sS", "-f", "-o", str(dest), f"{BUCKET}/{name}/{name}.tif"], capture_output=True)
    if r.returncode != 0:  # sea tiles do not exist
        dest.unlink(missing_ok=True)
        return None
    return dest


def read_dem(bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, float]:
    """Elevation (m) cropped to bbox, north up; returns (array, metres per pixel in y)."""
    import tifffile
    w, s, e, n = bbox
    rows = []
    for lat in range(math.floor(n), math.floor(s) - 1, -1):
        row = []
        for lon in range(math.floor(w), math.floor(e) + 1):
            p = fetch_tile(lat, lon)
            row.append(tifffile.imread(p).astype(np.float32) if p else np.zeros((3600, 3600), np.float32))
            # tiles narrower than 3600 px at high latitudes: resample to 3600 wide for simplicity
            if row[-1].shape[1] != 3600:
                row[-1] = np.asarray(Image.fromarray(row[-1]).resize((3600, 3600), Image.BILINEAR))
        rows.append(np.concatenate(row, axis=1))
    mosaic = np.concatenate(rows, axis=0)
    lon0, lat0 = math.floor(w), math.floor(n) + 1  # top-left corner of the mosaic
    px = 3600
    x0, x1 = int((w - lon0) * px), int(math.ceil((e - lon0) * px))
    y0, y1 = int((lat0 - n) * px), int(math.ceil((lat0 - s) * px))
    return mosaic[y0:y1, x0:x1], 111_320 / px


def hillshade(z: np.ndarray, dy: float, dx: float, az: float = 315, alt: float = 40, ex: float = 4.0) -> np.ndarray:
    gy, gx = np.gradient(z * ex, dy, dx)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = math.radians(az), math.radians(alt)
    hs = np.sin(b) * np.sin(slope) + np.cos(b) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--out", required=True, help="output path without extension")
    ap.add_argument("--exaggeration", type=float, default=3.0)
    ap.add_argument("--smooth-m", type=float, default=120.0, help="smoothing radius in metres")
    ap.add_argument("--max-px", type=int, default=1600)
    a = ap.parse_args()
    bbox = tuple(a.bbox)
    z, my = read_dem(bbox)
    mx = my * math.cos(math.radians((bbox[1] + bbox[3]) / 2))
    # GLO-30 is a surface model (includes today's trees and buildings): smooth
    # ~90-150 m so the landforms (ridges, valleys, slopes) dominate, not modern clutter
    import cv2
    k = max(3, int(round(a.smooth_m / my)) | 1)
    z = cv2.GaussianBlur(z, (k * 2 + 1, k * 2 + 1), k / 2)
    hs = hillshade(z, my, mx, ex=a.exaggeration)
    # elevation tint: higher ground slightly lighter; relief from the hillshade
    zn = (z - np.percentile(z, 2)) / max(1.0, np.percentile(z, 98) - np.percentile(z, 2))
    shade = 0.3 + 0.9 * (hs - 0.5) + 0.14 * np.clip(zn, 0, 1)
    rgb = np.stack([np.clip(LAND[i] + (HIGHLIGHT[i] - LAND[i]) * shade, 0, 255) for i in range(3)], axis=-1)
    img = Image.fromarray(rgb.astype(np.uint8))
    if max(img.size) > a.max_px:
        sc = a.max_px / max(img.size)
        img = img.resize((round(img.width * sc), round(img.height * sc)), Image.LANCZOS)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out.with_suffix(".png"))
    meta = {"src": out.with_suffix(".png").name, "bbox": list(bbox), "attribution": ATTRIBUTION,
            "elevation_m": [round(float(np.percentile(z, 2)), 1), round(float(np.percentile(z, 98)), 1)]}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {out.with_suffix('.png')} ({img.width}x{img.height}), elevation {meta['elevation_m']} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
