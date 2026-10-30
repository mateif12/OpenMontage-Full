#!/usr/bin/env python3
"""Visual regression for the historical-short composition.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Builds the original Cannae episode (rules_version 1: legacy map / image /
illustration / tactics scenes) into projects/_regression_cannae with silent
audio, the real Natural Earth basemap and neutral placeholder images, then
renders one preview still per scene. Compare the sheet with earlier runs after
any change to remotion-composer/src/historical-short/.

Usage:
    python scripts/historical_short/regression_render.py
Output: projects/_regression_cannae/renders/preview_sheet.jpg (gitignored)
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "tests" / "historical_short"))


def main() -> int:
    import shutil

    import yaml
    from test_cannae_compat import EPISODE, make_fixture

    root = REPO / "projects"
    proj = root / "_regression_cannae"
    shutil.rmtree(proj, ignore_errors=True)
    tmp = make_fixture(root / "_regression_tmp")
    tmp.rename(proj)
    shutil.rmtree(root / "_regression_tmp", ignore_errors=True)
    # fix provenance paths after the move, use the real basemap
    for prov in (proj / "assets" / "images").glob("*.provenance.json"):
        prov.write_text(prov.read_text().replace(str(root / "_regression_tmp" / "battle-of-cannae"), str(proj)))
    subprocess.run([sys.executable, str(HERE / "build_basemap.py"), "--bbox", "-10", "29", "22", "47",
                    "--out", str(proj / "assets" / "maps" / "basemap.json")], check=True)
    subprocess.run([sys.executable, str(HERE / "build_props.py"), "--episode", str(EPISODE), "--project", str(proj)],
                   check=True)
    ep = yaml.safe_load(EPISODE.read_text())
    times = ",".join(f"{(s['start'] + s['end']) / 2:.2f}" for s in ep["scenes"])
    subprocess.run([sys.executable, str(HERE / "render.py"), "--project", str(proj), "--preview", "--times", times],
                   check=True)
    print(proj / "renders" / "preview_sheet.jpg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
