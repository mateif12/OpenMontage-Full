#!/usr/bin/env python3
"""Build a coastline basemap (SVG path data) for original animated maps.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Source data: Natural Earth (public domain, https://www.naturalearthdata.com/),
downloaded from the official Natural Earth S3 bucket and cached locally.
Natural Earth shows MODERN coastlines; ancient coastlines differed in places
(silted river mouths, lagoons). The HistoricalShort map scene therefore says
"modern coastline" in its source label.

Projection: equirectangular, x = lon * cos(lat0), y = -lat (degrees). The
Remotion HistoricalMap component uses the same projection for markers and
routes, so lon/lat can be written directly in the episode file.

Usage:
    python scripts/historical_short/build_basemap.py \
        --bbox -10 29 22 47 --out projects/<ep>/assets/maps/basemap.json
    (bbox = west south east north, degrees)
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import zipfile
from pathlib import Path

import requests

try:
    import shapefile  # pyshp
except ImportError:  # pragma: no cover
    sys.exit("pyshp is required: pip install pyshp")

NE_URL = "https://naturalearth.s3.amazonaws.com/{res}_physical/ne_{res}_{layer}.zip"
CACHE = Path.home() / ".cache" / "openmontage" / "naturalearth"


def load_layer(res: str, layer: str) -> shapefile.Reader:
    CACHE.mkdir(parents=True, exist_ok=True)
    zpath = CACHE / f"ne_{res}_{layer}.zip"
    if not zpath.exists():
        r = requests.get(NE_URL.format(res=res, layer=layer), timeout=300)
        r.raise_for_status()
        zpath.write_bytes(r.content)
    z = zipfile.ZipFile(zpath)
    base = f"ne_{res}_{layer}"
    return shapefile.Reader(
        shp=io.BytesIO(z.read(f"{base}.shp")),
        shx=io.BytesIO(z.read(f"{base}.shx")),
        dbf=io.BytesIO(z.read(f"{base}.dbf")),
    )


def ring_paths(reader: shapefile.Reader, bbox: tuple[float, float, float, float], k: float,
               min_step: float) -> list[str]:
    w, s, e, n = bbox
    out = []
    for shp in reader.iterShapes():
        bw, bs, be, bn = shp.bbox
        if be < w or bw > e or bn < s or bs > n:
            continue
        parts = list(shp.parts) + [len(shp.points)]
        for a, b in zip(parts[:-1], parts[1:]):
            pts = shp.points[a:b]
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            if max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n:
                continue
            cmds, last = [], None
            for lon, lat in pts:
                x, y = lon * k, -lat
                if last and math.hypot(x - last[0], y - last[1]) < min_step:
                    continue
                cmds.append(f"{x:.3f} {y:.3f}")
                last = (x, y)
            if len(cmds) >= 3:
                out.append("M" + "L".join(cmds) + "Z")
    return out


def river_paths(reader: shapefile.Reader, bbox: tuple[float, float, float, float], k: float,
                min_step: float, names: set[str] | None) -> list[dict]:
    """Open polylines (rivers) inside bbox, optionally filtered by Natural Earth `name`."""
    w, s, e, n = bbox
    fields = [f[0] for f in reader.fields[1:]]
    out = []
    for rec, shp in zip(reader.iterRecords(), reader.iterShapes()):
        name = str(dict(zip(fields, rec)).get("name") or "")
        if names is not None and name not in names:
            continue
        bw, bs, be, bn = shp.bbox
        if be < w or bw > e or bn < s or bs > n:
            continue
        parts = list(shp.parts) + [len(shp.points)]
        for a, b in zip(parts[:-1], parts[1:]):
            cmds, last = [], None
            for lon, lat in shp.points[a:b]:
                x, y = lon * k, -lat
                if last and math.hypot(x - last[0], y - last[1]) < min_step:
                    continue
                cmds.append(f"{x:.3f} {y:.3f}")
                last = (x, y)
            if len(cmds) >= 2:
                out.append({"name": name, "d": "M" + "L".join(cmds)})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--res", default="10m", choices=["10m", "50m", "110m"])
    ap.add_argument("--min-step", type=float, default=0.02, help="drop vertices closer than this (degrees)")
    ap.add_argument("--rivers", nargs="*", metavar="NAME",
                    help="also include Natural Earth river centrelines (10m rivers_lake_centerlines + "
                         "rivers_europe); optionally only the named rivers, e.g. --rivers Rhine Weser")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    w, s, e, n = args.bbox
    lat0 = (s + n) / 2
    k = math.cos(math.radians(lat0))
    land = ring_paths(load_layer(args.res, "land"), (w, s, e, n), k, args.min_step)
    lakes = ring_paths(load_layer(args.res, "lakes"), (w, s, e, n), k, args.min_step)
    data = {
        "source": "Natural Earth (public domain), modern coastlines",
        "projection": "equirectangular",
        "lat0": lat0,
        "kx": k,
        "bbox": [w, s, e, n],
        "land": land,
        "lakes": lakes,
    }
    if args.rivers is not None:
        names = set(args.rivers) or None
        rivers = []
        for layer in ("rivers_lake_centerlines", "rivers_europe"):
            rivers += river_paths(load_layer("10m", layer), (w, s, e, n), k, args.min_step / 2, names)
        data["rivers"] = rivers
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data))
    print(f"wrote {out}: {len(land)} land rings, {len(lakes)} lake rings, {len(data.get('rivers', []))} river lines, {out.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
