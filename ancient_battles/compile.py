#!/usr/bin/env python3
"""Compile an ancient-battle episode into a render scene (JSON).

Reads the reusable library (equipment, civilizations, formations, behaviours)
and an episode configuration, validates historical consistency, and writes
`scene.json` for the 3D renderer.

Validation (errors stop the build):
  * every unit design must exist and its date range must include the battle year
  * every equipment item must be in use in the battle year
  * every item must belong to one of the unit's civilizations
  * designs may only use behaviours their profile allows
Every equipment item whose evidence is not "attested" becomes an on-screen
reconstruction note for the shots that show it.

Usage: python compile.py episodes/<id>/episode.yaml [--out <scene.json>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
LIB = ROOT / "library"


def fmt_year(y: int) -> str:
    return f"{-y} BC" if y < 0 else f"AD {y}"


def load_library() -> dict:
    lib = {
        "items": yaml.safe_load((LIB / "equipment.yaml").read_text())["items"],
        "formations": yaml.safe_load((LIB / "formations.yaml").read_text())["formations"],
        "behaviours": yaml.safe_load((LIB / "behaviours.yaml").read_text())["behaviours"],
        "designs": {},
    }
    for f in sorted((LIB / "civilizations").glob("*.yaml")):
        civ = yaml.safe_load(f.read_text())
        for did, d in civ["designs"].items():
            if did in lib["designs"]:
                raise SystemExit(f"duplicate design id {did}")
            d["civilization"] = civ["civilization"]
            lib["designs"][did] = d
    return lib


def kit_items(design: dict):
    for entry in design["kit"]:
        if "choice" in entry:
            for alt in entry["choice"]:
                yield alt
        else:
            yield entry


def validate_design(did: str, d: dict, year: int, lib: dict, errors: list[str]) -> None:
    lo, hi = d["dates"]
    if not lo <= year <= hi:
        errors.append(f"design {did} is dated {fmt_year(lo)}-{fmt_year(hi)}, battle is {fmt_year(year)}")
    for e in kit_items(d):
        item = lib["items"].get(e["item"])
        if item is None:
            errors.append(f"design {did}: unknown equipment item {e['item']}")
            continue
        a, b = item["dates"]
        if not a <= year <= b:
            errors.append(f"design {did}: {e['item']} in use {fmt_year(a)}-{fmt_year(b)}, not in {fmt_year(year)}")
        if d["civilization"] not in item["cultures"]:
            errors.append(f"design {did}: {e['item']} is not recorded for culture {d['civilization']}")
    for b in d.get("behaviours", []):
        if b not in lib["behaviours"]:
            errors.append(f"design {did}: unknown behaviour {b}")


def reconstruction_notes(design_ids: set[str], formation_ids: set[str], lib: dict) -> list[str]:
    notes: list[str] = []
    for did in sorted(design_ids):
        for e in kit_items(lib["designs"][did]):
            it = lib["items"][e["item"]]
            if it["evidence"] != "attested":
                n = it.get("label", it["name"])
                if n not in notes:
                    notes.append(n)
    for fid in sorted(formation_ids):
        f = lib["formations"][fid]
        if f.get("evidence") != "attested" and f.get("label") and f["label"] not in notes:
            notes.append(f["label"])
    return notes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--out")
    args = ap.parse_args()
    ep_path = Path(args.episode).resolve()
    ep = yaml.safe_load(ep_path.read_text())
    lib = load_library()
    year = ep["battle"]["year"]
    errors: list[str] = []

    # ---- units -> designs used
    units_out = {}
    side_designs: dict[str, set[str]] = {}
    side_forms: dict[str, set[str]] = {}
    for uid, u in ep["units"].items():
        side = ep["sides"][u["side"]]
        designs = [u[k] for k in ("design", "front", "rear") if k in u]
        if "rear_mix" in u:
            designs.append(u["rear_mix"]["design"])
        for did in designs:
            d = lib["designs"].get(did)
            if d is None:
                errors.append(f"unit {uid}: unknown design {did}")
                continue
            if d["civilization"] not in side["civilizations"]:
                errors.append(f"unit {uid}: design {did} ({d['civilization']}) not in side civilizations {side['civilizations']}")
            validate_design(did, d, year, lib, errors)
            side_designs.setdefault(u["side"], set()).add(did)
        fid = u.get("formation") or lib["designs"].get(u.get("design", ""), {}).get("formation")
        if fid not in lib["formations"]:
            errors.append(f"unit {uid}: unknown formation {fid}")
            continue
        form = lib["formations"][fid]
        side_forms.setdefault(u["side"], set()).add(fid)
        units_out[uid] = {**u, "formation": fid, "file_spacing": form["file_spacing"], "rank_spacing": form["rank_spacing"],
                          "timeline": ep["timeline"].get(uid, {})}

    # ---- resolve designs for the renderer
    designs_out = {}
    for did in sorted({d for s in side_designs.values() for d in s} | {c["design"] for c in ep.get("commanders", [])}
                      | {f["design"] for s in ep.get("poc", {}).get("showcase", []) for f in s["figures"]}):
        d = lib["designs"][did]
        validate_design(did, d, year, lib, errors)
        def item_out(e):
            it = lib["items"][e["item"]]
            return {**e, "render": it["render"], "name": it["name"], "evidence": it["evidence"]}
        kit = []
        for e in d["kit"]:
            if "choice" in e:
                kit.append({"choice": [item_out(alt) for alt in e["choice"]]})
            else:
                kit.append(item_out(e))
        designs_out[did] = {"label": d["label"], "civilization": d["civilization"], "role": d["role"],
                            "body": d.get("body", {}), "kit": kit, "behaviours": d.get("behaviours", [])}

    if errors:
        print("HISTORICAL VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        sys.exit(1)

    # ---- per-side reconstruction notes, attached to shots
    notes = {s: reconstruction_notes(side_designs.get(s, set()), side_forms.get(s, set()), lib) for s in ep["sides"]}
    poc = ep.get("poc", {})
    shots = []
    for sh in poc.get("shots", []):
        anchor = sh["anchor"]
        sides = [ep["units"][anchor]["side"]] if anchor in ep["units"] else list(ep["sides"])
        sh = {**sh, "notes": sh.get("notes") or [n for s in sides for n in notes[s]]}
        shots.append(sh)

    # ---- captions from the transcript (audio is never modified)
    a0, a1 = poc["animation"]["start"], poc["animation"]["end"]
    tr_path = (ep_path.parent / ep["audio"]["transcript"]).resolve()
    fixes = ep["audio"].get("caption_fixes", {})
    words = []
    for seg in json.loads(tr_path.read_text()):
        for w in seg["words"]:
            txt = w["w"].strip()
            core = txt.strip(".,;:!?")
            if core in fixes:
                txt = txt.replace(core, fixes[core])
            words.append({"w": txt, "s": w["s"], "e": w["e"]})

    scene = {
        "battle": ep["battle"], "year_label": fmt_year(year),
        "sides": ep["sides"], "units": units_out, "commanders": ep.get("commanders", []),
        "designs": designs_out, "world": ep["world"], "poc": {**poc, "shots": shots},
        "captions": words, "notes_by_side": notes,
        "label": "DIGITAL 3D RECONSTRUCTION",
        "audio": str((ep_path.parent / ep["audio"]["narration"]).resolve()),
    }
    out = Path(args.out) if args.out else ep_path.parent / "scene.json"
    out.write_text(json.dumps(scene, indent=1))
    n = sum(1 for _ in units_out)
    print(f"OK {ep['battle']['name']} ({fmt_year(year)}): {n} units, {len(designs_out)} designs validated -> {out}")
    for s, ns in notes.items():
        print(f"  reconstruction notes [{s}]: {', '.join(ns) or '-'}")


if __name__ == "__main__":
    main()
