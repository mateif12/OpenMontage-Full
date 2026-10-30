"""Historical-short Phase 4: map sides, terrain helpers and coverage rule (no network)."""
import json

import numpy as np

import build_props
import build_terrain
import episode_rules


def test_tile_names():
    assert build_terrain.tile_name(50, 4) == "Copernicus_DSM_COG_10_N50_00_E004_00_DEM"
    assert build_terrain.tile_name(-34, -59) == "Copernicus_DSM_COG_10_S34_00_W059_00_DEM"


def test_hillshade_lights_slopes_facing_northwest():
    x = np.linspace(0, 1, 50, dtype=np.float32)
    z = np.tile(x * 100, (50, 1))  # rises to the east -> faces west -> lit by NW light
    lit = build_terrain.hillshade(z, 30, 30, ex=1)
    z2 = np.tile((1 - x) * 100, (50, 1))  # faces east -> darker
    dark = build_terrain.hillshade(z2, 30, 30, ex=1)
    assert lit.mean() > dark.mean()


def test_resolve_map_sides(tmp_path):
    sc = {"id": "m", "units": [{"side": "french", "keys": [{"t": 0, "lon": 0, "lat": 0}]}],
          "routes": [{"side": "allied", "points": [[0, 0], [1, 1]]}], "markers": [{"side": "nope"}]}
    errors, used = [], []
    build_props.resolve_map(sc, {"sides": {"french": "#123456", "allied": "#654321"}}, tmp_path, errors, used)
    assert sc["units"][0]["color"] == "#123456" and sc["routes"][0]["color"] == "#654321"
    assert any("not in episode `sides:`" in e for e in errors)


def test_terrain_coverage_warning(tmp_path):
    (tmp_path / "assets" / "maps").mkdir(parents=True)
    (tmp_path / "assets" / "maps" / "t.json").write_text(json.dumps({"src": "t.png", "bbox": [4.3, 50.62, 4.56, 50.74]}))
    ep = {"scenes": [{"id": "m", "kind": "map", "start": 0, "end": 3, "terrain": "maps/t.json",
                      "camera": [{"t": 0, "lon": 4.43, "lat": 50.68, "span": 0.2}]}]}
    rep = episode_rules.Report()
    episode_rules.check_map_layout(ep, tmp_path, {"words": []}, rep)
    assert any("beyond the terrain relief" in w for w in rep.warnings)
    ep["scenes"][0]["camera"][0]["span"] = 0.08
    rep = episode_rules.Report()
    episode_rules.check_map_layout(ep, tmp_path, {"words": []}, rep)
    assert not any("beyond the terrain relief" in w for w in rep.warnings)
