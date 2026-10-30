"""Historical-short Phase 3: period kits, battle-scene resolution, AI review gate."""
import re
from pathlib import Path

import pytest
import yaml

import build_props
import periods

REPO = Path(__file__).resolve().parents[2]
FIGURES = (REPO / "remotion-composer/src/historical-short/figures.tsx").read_text()
HEADGEAR = set(re.findall(r'case "([a-z0-9-]+)":', FIGURES.split("const Weapon")[0]))
WEAPONS = {"musket", "rifle", "pike", "spear", "sword", "sabre", "lance", "bow", "none"}
SHIELDS = {"none", "round", "scutum", "kite", "aspis", None}
TEMPLATES = set(build_props.TEMPLATE_TITLES)
KITS = periods.available()


def test_every_detected_period_has_a_kit():
    assert {pid for pid, _, _ in periods.RANGES} <= set(KITS)


@pytest.mark.parametrize("pid", KITS)
def test_kit_schema(pid):
    kit = periods.load_kit(pid)
    for key in ("name", "years", "palette", "environment", "artillery", "templates", "factions", "ai"):
        assert key in kit, f"{pid}: missing {key}"
    for key in ("sky_top", "sky_bottom", "light", "haze", "ground_far", "ground_near", "smoke", "shadow"):
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", kit["palette"][key]), f"{pid}: palette {key}"
    assert set(kit["templates"]) <= TEMPLATES
    if kit["artillery"]["type"] == "none":
        assert "artillery" not in kit["templates"] and "volley" not in kit["templates"]
    for name, f in kit["factions"].items():
        assert f.get("headgear") in HEADGEAR, f"{pid}/{name}: headgear {f.get('headgear')} not drawable"
        assert f.get("weapon") in WEAPONS, f"{pid}/{name}: weapon {f.get('weapon')}"
        assert f.get("shield") in SHIELDS, f"{pid}/{name}: shield {f.get('shield')}"
        if f.get("role") == "cavalry":
            assert f.get("horse"), f"{pid}/{name}: cavalry needs a horse colour"
    crew = kit["artillery"].get("crew")
    assert crew is None or crew in kit["factions"]
    assert kit["ai"]["negative"] and kit["ai"]["style"]


def test_gunpowder_never_in_ancient_or_medieval_kits():
    for pid in ("ancient-mediterranean", "medieval"):
        kit = periods.load_kit(pid)
        assert all(f["weapon"] not in ("musket", "rifle") for f in kit["factions"].values())
        assert "musket" in kit["ai"]["negative"] or "firearms" in kit["ai"]["negative"]


def _battle(**kw):
    return {"id": "s1", "kind": "battle", "start": 0, "end": 4, "template": "volley",
            "left": {"faction": "french-line"}, "right": "british-line", **kw}


def test_resolve_battle_ok():
    sc, errors = _battle(fireAt=[1.0]), []
    build_props.resolve_battle(sc, {"period": "napoleonic"}, errors)
    assert not errors
    assert sc["left"]["faction"]["headgear"] == "shako" and sc["right"]["faction"]["coat"] == "#b3261e"
    assert sc["kit"]["artillery"]["crew"]["label"] == "French foot artillery"
    assert sc["label"]["tag"].startswith("ORIGINAL ILLUSTRATION")


def test_resolve_battle_rejects_anachronisms():
    errors = []
    build_props.resolve_battle(_battle(left={"faction": "roman-legion"}, right=None), {"period": "napoleonic"}, errors)
    assert any("not in period kit" in e for e in errors)
    errors = []
    build_props.resolve_battle(_battle(template="artillery", left={"faction": "roman-legion"}),
                               {"period": "ancient-mediterranean"}, errors)
    assert any("not available for period" in e for e in errors)


def test_ai_gate():
    sc, errors = {"id": "s1"}, []
    build_props.check_generated(sc, {"generated": True, "asset_id": "x", "review": {"status": "pending"}}, errors)
    assert any("no approved accuracy review" in e for e in errors)
    sc, errors = {"id": "s1", "label": {"tag": "PAINTING", "title": "x"}}, []
    build_props.check_generated(sc, {"generated": True, "asset_id": "x",
                                     "review": {"status": "approved", "notes": "uniforms and weapons checked ok"}}, errors)
    assert any("must say so" in e for e in errors)
    sc, errors = {"id": "s1"}, []
    build_props.check_generated(sc, {"generated": True, "asset_id": "x",
                                     "review": {"status": "approved", "notes": "uniforms and weapons checked ok"}}, errors)
    assert not errors and "AI-ASSISTED" in sc["label"]["tag"]
