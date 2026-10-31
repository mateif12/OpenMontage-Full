#!/usr/bin/env python3
"""Turn an episode.yaml into HistoricalShort Remotion props + CREDITS.txt.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Checks (fails loudly, never silently patches):
  * narration duration is read from the MP3 (ffprobe) — it sets video length
  * scenes are ordered, contiguous (gaps <= 0.05 s) and cover 0 .. duration
  * every image scene has a downloaded file + provenance with commercial_ok
  * every image scene has a label (what the viewer is looking at)

Usage:
    python scripts/historical_short/build_props.py \
        --episode scripts/historical_short/episodes/battle-of-cannae.yaml \
        --project projects/battle-of-cannae
Outputs:
    <project>/artifacts/props.json
    <project>/CREDITS.txt
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import yaml


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def find_asset(images_dir: Path, asset_id: str) -> tuple[Path, dict]:
    prov_path = images_dir / f"{asset_id}.provenance.json"
    if not prov_path.exists():
        raise SystemExit(f"missing provenance for image '{asset_id}' ({prov_path}). "
                         "Fetch it with fetch_commons.py first.")
    prov = json.loads(prov_path.read_text())
    img = Path(prov["local_path"])
    if not img.is_absolute():
        img = Path.cwd() / img
    if not img.exists():
        raise SystemExit(f"image file missing for '{asset_id}': {img}")
    return img, prov


def default_credit(prov: dict) -> str:
    author = prov.get("credit_override") or prov.get("author") or "Unknown author"
    return f"{author} · {prov.get('licence')} · Wikimedia Commons"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--episode", required=True)
    ap.add_argument("--project", required=True)
    args = ap.parse_args()

    ep = yaml.safe_load(Path(args.episode).read_text())
    project = Path(args.project)
    assets = project / "assets"  # Remotion --public-dir
    images_dir = assets / ep.get("images_dir", "images")

    narration_rel = ep["narration"]
    duration = probe_duration(assets / narration_rel)
    captions = json.loads((project / "artifacts" / "captions.json").read_text())

    errors: list[str] = []
    substitutions: list[str] = []
    scenes_out = []
    credits = []
    prev_end = 0.0
    for i, sc in enumerate(ep["scenes"]):
        sc = dict(sc)
        if abs(sc["start"] - prev_end) > 0.05:
            errors.append(f"scene {sc['id']}: starts at {sc['start']} but previous ends at {prev_end}")
        if sc["end"] <= sc["start"]:
            errors.append(f"scene {sc['id']}: end <= start")
        prev_end = sc["end"]
        fallback = sc.pop("fallback", None)
        if sc["kind"] == "image" and fallback is not None and \
                not (images_dir / f"{sc['asset']}.provenance.json").exists():
            # authentic still not available (e.g. download blocked): use the declared
            # original-graphics fallback for the same time slot, and say so
            substitutions.append(f"{sc['id']}: image '{sc['asset']}' unavailable -> {fallback['kind']} fallback")
            sc = {"id": sc["id"], "start": sc["start"], "end": sc["end"], **fallback}
        if sc["kind"] == "image":
            asset_id = sc.pop("asset")
            img, prov = find_asset(images_dir, asset_id)
            if not prov.get("commercial_ok") and not sc.pop("licence_manually_reviewed", False):
                errors.append(f"scene {sc['id']}: licence not commercial-safe ({prov.get('licence_verdict')})")
            sc["src"] = str(img.relative_to(assets.resolve()) if img.is_absolute() and str(img).startswith(str(assets.resolve()))
                            else img.relative_to(assets))
            label = sc.get("label")
            if not label:
                errors.append(f"scene {sc['id']}: image scene without on-screen label")
            elif not label.get("credit"):
                label["credit"] = default_credit({**prov, "credit_override": sc.pop("credit_author", None)})
            sc.pop("credit_author", None)
            credits.append((sc["id"], prov, label.get("credit") if label else ""))
        elif sc.get("background_asset") and not (images_dir / f"{sc['background_asset']}.provenance.json").exists() \
                and sc.get("background_optional"):
            substitutions.append(f"{sc['id']}: background '{sc.pop('background_asset')}' unavailable -> plain background")
        elif sc.get("background_asset"):  # end card / title background still
            img, prov = find_asset(images_dir, sc.pop("background_asset"))
            if not prov.get("commercial_ok"):
                errors.append(f"scene {sc['id']}: background licence not commercial-safe")
            sc["background"] = str(img.relative_to(assets.resolve()) if img.is_absolute() and str(img).startswith(str(assets.resolve()))
                                   else img.relative_to(assets))
            credits.append((sc["id"], prov, default_credit(prov)))
        sc.pop("background_optional", None)
        scenes_out.append(sc)
    if abs(prev_end - duration) > 0.5:
        errors.append(f"last scene ends at {prev_end} but narration is {duration:.2f}s")

    if errors:
        print("EPISODE INVALID:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 2

    props = {
        "durationSeconds": round(duration, 3),
        "narrationSrc": narration_rel,
        "scenes": scenes_out,
        "captions": captions["words"],
    }
    amb = ep.get("ambience")
    if amb and (assets / amb["src"]).exists():
        props["ambienceSrc"] = amb["src"]
        props["ambienceVolume"] = amb.get("volume", 0.05)
    if ep.get("caption_style"):
        props["captionStyle"] = ep["caption_style"]
    cues = project / "artifacts" / "subtitle_cues.json"  # build_subtitles.py (landscape documentaries)
    if cues.exists():
        props["subtitleCues"] = json.loads(cues.read_text())

    if substitutions:
        props["substitutions"] = substitutions
        print("SUBSTITUTIONS (authentic asset unavailable):\n  " + "\n  ".join(substitutions))
    out = project / "artifacts" / "props.json"
    out.write_text(json.dumps(props, indent=1, ensure_ascii=False))

    lines = [f"{ep.get('title', '')} — image and data credits", ""]
    if not credits:
        lines += ["No third-party photographs or footage appear in this render.", ""]
    if substitutions:
        lines += ["Planned authentic images that could not be used in this render (replaced by original graphics):"]
        lines += [f"  {x}" for x in substitutions] + [""]
    seen: dict[str, list[str]] = {}
    for sid, prov, shown in credits:
        seen.setdefault(prov["title"], []).append(sid)
    done = set()
    for sid, prov, shown in credits:
        if prov["title"] in done:
            continue
        done.add(prov["title"])
        lines += [
            f"[{', '.join(seen[prov['title']])}] {prov.get('object_name') or prov['title']}",
            f"    Author/creator: {prov.get('author') or 'n/a'}",
            f"    Licence: {prov.get('licence')}  {prov.get('licence_url') or ''}".rstrip(),
            f"    Source: {prov.get('page_url')}",
        ]
        if prov.get("restrictions"):
            note = prov["restrictions"]
            if "ita-mibac" in note:
                note += (" (Italian cultural-heritage rules: commercial reproduction of Italian state-held"
                         " cultural property may need the managing institution's permission)")
            lines.append(f"    Restrictions noted on Commons: {note}")
        lines.append("")
    illus = [s["id"] for s in scenes_out if s["kind"] in ("illustration", "tactics", "map", "battle", "profiles", "legions")]
    for extra in ep.get("extra_credits", []):
        lines.append(extra)
    lines += ["", f"Original maps, diagram and illustrations ({', '.join(illus)}): created for this video;"
              " coastlines from Natural Earth (public domain).",
              ] + ([] if ep.get("extra_credits") else ["Narration: supplied by the channel (ElevenLabs)."])
    (project / "CREDITS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(scenes_out)} scenes, {duration:.2f}s) and {project / 'CREDITS.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
