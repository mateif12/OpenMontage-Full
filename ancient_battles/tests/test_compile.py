"""Network-free checks for the ancient-battles compiler (run: python -m pytest ancient_battles/tests)."""
import copy
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
EP = ROOT / "episodes" / "marathon-490bc" / "episode.yaml"


def run(ep_dict, tmp_path):
    p = tmp_path / "episode.yaml"
    d = copy.deepcopy(ep_dict)
    d["audio"]["transcript"] = str((EP.parent / d["audio"]["transcript"]).resolve())
    d["audio"]["narration"] = str((EP.parent / d["audio"]["narration"]).resolve())
    p.write_text(yaml.safe_dump(d))
    return subprocess.run([sys.executable, str(ROOT / "compile.py"), str(p), "--out", str(tmp_path / "scene.json")], capture_output=True, text=True)


def test_marathon_compiles(tmp_path):
    ep = yaml.safe_load(EP.read_text())
    r = run(ep, tmp_path)
    assert r.returncode == 0, r.stderr
    assert "wicker shield wall" in r.stdout


def test_wrong_century_is_rejected(tmp_path):
    ep = yaml.safe_load(EP.read_text())
    ep["battle"]["year"] = -216  # Cannae: late-archaic hoplites and Achaemenid kit are out of period
    r = run(ep, tmp_path)
    assert r.returncode == 1
    assert "hoplite-late-archaic is dated" in r.stderr
    assert "spara in use" in r.stderr


def test_wrong_civilization_is_rejected(tmp_path):
    ep = yaml.safe_load(EP.read_text())
    ep["units"]["greek-left"]["design"] = "persian-archer"
    r = run(ep, tmp_path)
    assert r.returncode == 1
    assert "not in side civilizations" in r.stderr
