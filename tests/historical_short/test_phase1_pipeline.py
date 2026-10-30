"""Historical-short workflow: network-free checks for planning, rules, library."""
from pathlib import Path

import pytest
import yaml

import build_props
import episode_rules
import fetch_commons
import periods
import plan_scenes

LIB = Path(fetch_commons.__file__).resolve().parent / "library"


@pytest.mark.parametrize("topic,year,period", [
    ("The Battle of Cannae (216 BC)", -216, "ancient-mediterranean"),
    ("The Battle of Waterloo (1815)", 1815, "napoleonic"),
    ("The Fall of Constantinople (1453)", 1453, "early-modern"),
    ("Battle of Hastings, AD 1066", 1066, "medieval"),
    ("Battle of the Somme 1916", 1916, "first-world-war"),
    ("Gettysburg 1863", 1863, "nineteenth-century"),
    ("No year here", None, None),
])
def test_period_detection(topic, year, period):
    assert periods.parse_year(topic) == year
    assert periods.detect_period(topic) == period


def test_combat_words():
    c = episode_rules.COMBAT_WORDS
    assert c.search("Napoleon launched a fierce attack")
    assert c.search("As the Prussians joined the battle")
    assert not c.search("One day, one battlefield, the end of an empire.")
    assert not c.search("The Battle of Waterloo ended Napoleon's rule forever.")


def _ep(scenes, version=2):
    return {"rules_version": version, "scenes": scenes, "narration": "x"}


def _sc(i, kind, a, b, **kw):
    return {"id": f"s{i}", "kind": kind, "start": a, "end": b, **kw}


CAPS = {"words": [], "sentences": [
    {"startMs": 0, "endMs": 4000, "text": "Napoleon launched a fierce attack."},
    {"startMs": 4500, "endMs": 9000, "text": "Paris lies on the Seine."},
]}


def test_rules_map_share_and_combat_strict(tmp_path):
    ep = _ep([_sc(1, "map", 0, 4.2, camera=[]), _sc(2, "map", 4.2, 10)])
    rep = episode_rules.validate(ep, tmp_path, 10, CAPS)
    joined = " ".join(rep.errors)
    assert "fill 100%" in joined and "in a row" in joined and "combat beat" in joined


def test_rules_legacy_episode_only_warns(tmp_path):
    ep = _ep([_sc(1, "map", 0, 4.2, camera=[]), _sc(2, "map", 4.2, 10)], version=1)
    rep = episode_rules.validate(ep, tmp_path, 10, CAPS)
    assert not rep.errors and rep.warnings


def test_rules_allow_for_combat_and_good_episode(tmp_path):
    ep = _ep([_sc(1, "image", 0, 4.2), _sc(2, "map", 4.2, 6.5, camera=[]), _sc(3, "image", 6.5, 10)])
    assert not episode_rules.validate(ep, tmp_path, 10, CAPS).errors


def test_painting_under_captions_warning(tmp_path):
    ep = _ep([_sc(1, "image", 0, 10, fit="contain-blur")])
    rep = episode_rules.validate(ep, tmp_path, 10, {"words": [], "sentences": []}, {"s1": (1000, 800)})
    assert any("under the captions" in w for w in rep.warnings)
    ep = _ep([_sc(1, "image", 0, 10, fit="contain-blur", panY=[-320, -320])])
    rep = episode_rules.validate(ep, tmp_path, 10, {"words": [], "sentences": []}, {"s1": (1000, 800)})
    assert not any("under the captions" in w for w in rep.warnings)


def test_clean_object_name():
    raw = ('The Battle of Waterlootitle QS:P1476,en:"The Battle of Waterloo"label QS:Les,"Batalla"')
    assert build_props.clean_object_name(raw) == "The Battle of Waterloo"
    assert build_props.clean_object_name("Plain name") == "Plain name"


def _caps(sentences):
    words, sents = [], []
    for t0, t1, text in sentences:
        toks = text.split()
        step = (t1 - t0) / len(toks)
        for i, w in enumerate(toks):
            words.append({"word": w, "startMs": int((t0 + i * step) * 1000), "endMs": int((t0 + (i + 1) * step) * 1000)})
        sents.append({"startMs": int(t0 * 1000), "endMs": int(t1 * 1000), "text": text})
    return {"words": words, "sentences": sents}


def test_planner_cuts_are_contiguous_and_cover_duration():
    caps = _caps([(0.2, 1.0, "June 1815."), (1.5, 5.0, "The armies met near the village at dawn today."),
                  (5.6, 14.0, "French soldiers attacked the farm again and again while the defenders held on "
                              "until evening when the last reserves arrived from the east")])
    beats = plan_scenes.beats_from_captions(caps, 15.0)
    assert beats[0]["start"] == 0.0 and beats[-1]["end"] == 15.0
    for a, b in zip(beats, beats[1:]):
        assert a["end"] == b["start"]
    assert beats[0]["text"].startswith("June 1815.")  # short sentence merged
    assert any(b.get("split") for b in beats)          # long sentence split


def test_pack_integrity_and_library_licences():
    for pack_path in sorted((LIB / "packs").glob("*.yaml")):
        pack = yaml.safe_load(pack_path.read_text())
        ids = [a["id"] for a in pack["assets"]]
        assert len(ids) == len(set(ids)), pack_path
        for a in pack["assets"]:
            assert a.get("label", {}).get("tag") and a.get("label", {}).get("title"), a["id"]
            page = fetch_commons._library_lookup(a["title"])
            assert page is not None, f"{a['id']}: no library record"
            assert fetch_commons.provenance(page)["commercial_ok"], a["id"]
