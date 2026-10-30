"""Regression: the original Cannae episode (rules_version 1, legacy scene fields)
still builds unchanged with the upgraded workflow. Uses a stub basemap and
placeholder images (no network); rendering is covered by regression_render.py."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "scripts" / "historical_short"
EPISODE = SCRIPTS / "episodes" / "battle-of-cannae.yaml"


def make_fixture(root: Path) -> Path:
    """Project dir with silent narration, stub captions/basemap, placeholder images."""
    from PIL import Image
    ep = yaml.safe_load(EPISODE.read_text())
    proj = root / "battle-of-cannae"
    (proj / "artifacts").mkdir(parents=True)
    audio = proj / "assets" / "audio"
    audio.mkdir(parents=True)
    dur = ep["scenes"][-1]["end"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(dur),
                    str(audio / "narration_master.wav")], check=True)
    (proj / "artifacts" / "captions.json").write_text(json.dumps({"words": [], "sentences": []}))
    maps = proj / "assets" / "maps"
    maps.mkdir(parents=True)
    (maps / "basemap.json").write_text(json.dumps({"kx": 0.78, "land": [], "lakes": []}))
    images = proj / "assets" / "images"
    images.mkdir(parents=True)
    for asset in {s["asset"] for s in ep["scenes"] if s["kind"] == "image"}:
        p = images / f"{asset}.jpg"
        Image.new("RGB", (900, 1200), (90, 80, 70)).save(p)
        (images / f"{asset}.provenance.json").write_text(json.dumps({
            "title": f"File:{asset}.jpg", "local_path": str(p), "licence": "test", "commercial_ok": True,
            "author": "fixture", "page_url": "https://example.invalid"}))
    return proj


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required")
def test_cannae_episode_still_builds(tmp_path):
    proj = make_fixture(tmp_path)
    r = subprocess.run([sys.executable, str(SCRIPTS / "build_props.py"), "--episode", str(EPISODE),
                        "--project", str(proj)], capture_output=True, text=True, cwd=REPO)
    assert r.returncode == 0, r.stderr
    assert "ERROR" not in r.stderr  # legacy episode: rule findings are warnings only
    props = json.loads((proj / "artifacts" / "props.json").read_text())
    kinds = [s["kind"] for s in props["scenes"]]
    assert kinds == ["map", "image", "map", "illustration", "tactics", "illustration", "image", "image", "map"]
    assert "globalFx" not in props  # no grain unless opted in
    bust = next(s for s in props["scenes"] if s["id"] == "s02_bust" or s["id"] == "s02_hannibal_bust")
    assert "camera" not in bust and bust["fit"] == "contain-blur" and bust["blurSrc"].startswith("images/_bg/")
    tactics = next(s for s in props["scenes"] if s["kind"] == "tactics")
    assert tactics["times"]["trapped"] == 33.59
