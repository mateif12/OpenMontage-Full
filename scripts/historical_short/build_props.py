#!/usr/bin/env python3
"""Turn an episode.yaml into HistoricalShort Remotion props + CREDITS.txt.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Checks (fails loudly, never silently patches):
  * narration duration is read from the MP3 (ffprobe) — it sets video length
  * scenes are ordered, contiguous (gaps <= 0.05 s) and cover 0 .. duration
  * every image scene has a downloaded file + provenance with commercial_ok
  * every image scene has a label (what the viewer is looking at)
  * storytelling + layout rules (episode_rules.py): map share, combat beats,
    captions vs paintings, map labels — errors fail for rules_version >= 2

Speed: blurred backdrops for contain/camera image scenes are pre-rendered
once here (assets/images/_bg/) instead of a CSS blur on every frame.

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

import re

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_rules  # noqa: E402


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


def make_grain(out_dir: Path, n: int = 3) -> list[Path]:
    """Film-grain tiles (monochrome noise around mid-grey), rendered once."""
    import numpy as np
    from PIL import Image, ImageFilter
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i in range(n):
        p = out_dir / f"grain_{i}.jpg"
        if not p.exists():
            rng = np.random.default_rng(1000 + i)
            noise = rng.normal(128, 38, (1060, 640)).clip(0, 255).astype("uint8")
            Image.fromarray(noise, "L").filter(ImageFilter.GaussianBlur(0.6)).resize((1280, 2120)).save(p, quality=80)
        paths.append(p)
    return paths


def ensure_layers(img: Path, asset_id: str, images_dir: Path, n: int) -> list[dict]:
    """Depth layers for parallax (make_layers.py), cached per asset + layer count."""
    import make_layers
    out = images_dir / "_layers" / f"{asset_id}_{n}"
    meta = out / "layers.json"
    if meta.exists() and meta.stat().st_mtime >= img.stat().st_mtime:
        layers = json.loads(meta.read_text())["layers"]
    else:
        layers = make_layers.make_layers(img, out, n)
    return [{"src": str((out / l["src"]).relative_to(images_dir.parent)), "depth": l["depth"]} for l in layers]


AI_LABEL_TAG = "AI-ASSISTED ILLUSTRATION · ARTISTIC INTERPRETATION"


def check_generated(sc: dict, prov: dict, errors: list[str]) -> None:
    """Locally generated (AI-assisted) images: approved accuracy review + honest label."""
    if not prov.get("generated"):
        return
    review = prov.get("review") or {}
    if review.get("status") != "approved" or len(review.get("notes") or "") < 15:
        errors.append(f"scene {sc['id']}: AI-assisted image '{prov.get('asset_id')}' has no approved accuracy "
                      "review — look at it, then run generate_illustration.py review --approve/--reject --notes ...")
    label = sc.setdefault("label", {"tag": AI_LABEL_TAG, "title": prov.get("title", "AI-assisted illustration")})
    tag = (label.get("tag") or "").upper()
    if "AI" not in tag.replace("PAINTING", "") or "ILLUSTRATION" not in tag:
        errors.append(f"scene {sc['id']}: label tag for an AI-assisted image must say so, e.g. '{AI_LABEL_TAG}'")
    label.setdefault("credit", "Original illustration · AI-assisted, generated locally")


def resolve_map(sc: dict, ep: dict, assets: Path, errors: list[str], terrain_used: list[str]) -> None:
    """Map scenes: `side:` names -> colours (episode `sides:`), file checks."""
    sides = ep.get("sides") or {}

    def colour(obj: dict, what: str) -> None:
        side = obj.pop("side", None)
        if side is None:
            return
        if side not in sides:
            errors.append(f"scene {sc['id']}: {what} side {side!r} not in episode `sides:` ({', '.join(sides)})")
            return
        obj.setdefault("color", sides[side])

    for u in sc.get("units") or []:
        colour(u, "unit")
        if not u.get("color"):
            errors.append(f"scene {sc['id']}: unit {u.get('label')!r} needs `side:` or `color:`")
        if not u.get("keys"):
            errors.append(f"scene {sc['id']}: unit {u.get('label')!r} has no keys")
    for r in sc.get("routes") or []:
        colour(r, "route")
    for m in sc.get("markers") or []:
        colour(m, "marker")
    for key in ("basemap", "terrain"):
        ref = sc.get(key)
        if ref and ref != "none" and not (assets / ref).exists():
            errors.append(f"scene {sc['id']}: {key} file {ref} not found under assets/")
    if sc.get("terrain"):
        meta = assets / sc["terrain"]
        if meta.exists():
            terrain_used.append(json.loads(meta.read_text()).get("attribution", ""))


TEMPLATE_TITLES = {
    "line-advance": "Infantry advancing in line",
    "volley": "Infantry firing a volley",
    "cavalry-charge": "A cavalry charge",
    "artillery": "An artillery battery in action",
    "assault": "An assault on a strongpoint",
    "aftermath": "The field after the fighting",
    "armies-facing": "Two armies face each other",
}


def resolve_battle(sc: dict, ep: dict, errors: list[str]) -> None:
    """Fill a `battle` scene with its resolved period kit and faction uniforms."""
    import periods
    period = sc.pop("period", None) or ep.get("period")
    if not period or period == "TODO":
        errors.append(f"scene {sc['id']}: battle scene needs `period:` (episode or scene)")
        return
    kit = periods.load_kit(period)
    if sc.get("template") not in kit.get("templates", []):
        errors.append(f"scene {sc['id']}: template {sc.get('template')!r} not available for period {period} "
                      f"(available: {', '.join(kit.get('templates', []))})")
        return
    factions = kit.get("factions", {})

    def faction(name: str | dict) -> dict | None:
        if isinstance(name, dict):  # inline custom uniform
            return name
        if name not in factions:
            errors.append(f"scene {sc['id']}: faction {name!r} not in period kit {period} "
                          f"(available: {', '.join(factions)})")
            return None
        return dict(factions[name])

    for side in ("left", "right"):
        if side not in sc:
            continue
        spec = sc[side] if isinstance(sc[side], dict) else {"faction": sc[side]}
        out = {"faction": faction(spec["faction"])}
        if spec.get("cavalry"):
            out["cavalry"] = faction(spec["cavalry"])
        if spec.get("count"):
            out["count"] = max(3, min(28, int(spec["count"])))
        sc[side] = out
    if "left" not in sc:
        errors.append(f"scene {sc['id']}: battle scene needs `left: {{faction: <preset>}}`")
    art = dict(kit.get("artillery") or {"type": "none"})
    if art.get("crew"):
        art["crew"] = faction(art["crew"])
    if sc.get("template") == "artillery" and art.get("type") == "none":
        errors.append(f"scene {sc['id']}: period {period} has no artillery")
    sc["kit"] = {"id": period, "name": kit.get("name", period), "palette": kit["palette"],
                 "environment": kit.get("environment", {}), "artillery": art}
    for f in sc.get("fireAt") or []:
        if not (sc["start"] <= f <= sc["end"]):
            errors.append(f"scene {sc['id']}: fireAt {f} outside the scene")
    sc.setdefault("label", {
        "tag": "ORIGINAL ILLUSTRATION · ARTISTIC INTERPRETATION",
        "title": sc.pop("title", None) or TEMPLATE_TITLES.get(sc["template"], "Battle scene"),
        "detail": f"Generic figures · simplified {kit.get('name', period)} uniforms · not specific units",
    })
    sc.pop("title", None)


# notes written by plan_scenes.py — never passed to the composition
PLAN_NOTE_KEYS = {"sentence", "tags", "suggest", "pack_candidates", "notes"}


def clean_object_name(name: str) -> str:
    """Commons ObjectName often carries Wikidata markup ('title QS:P1476,...',
    'label QS:Len,...'); keep only the human-readable part."""
    name = re.split(r"\s*(?:title|label) QS:", name or "")[0]
    return re.sub(r"\s+", " ", name).strip()


def make_backdrop(img: Path, out: Path) -> None:
    """Blurred, darkened backdrop (same look as the old CSS
    blur(38px) brightness(0.42) saturate(0.8)), rendered once."""
    from PIL import Image, ImageEnhance, ImageFilter
    if out.exists() and out.stat().st_mtime >= img.stat().st_mtime:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(img).convert("RGB")
    # cover-fit a 1240x2080 canvas (frame + 80 px bleed), blur at low res
    tw, th = 310, 520
    scale = max(tw / im.width, th / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    left, top = (im.width - tw) // 2, (im.height - th) // 2
    im = im.crop((left, top, left + tw, top + th)).filter(ImageFilter.GaussianBlur(9.5))
    im = ImageEnhance.Color(im).enhance(0.8)
    im = ImageEnhance.Brightness(im).enhance(0.42)
    im.resize((1240, 2080), Image.BICUBIC).save(out, quality=88)


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
    image_sizes: dict[str, tuple[int, int]] = {}
    terrain_used: list[str] = []
    scenes_out = []
    credits = []
    prev_end = 0.0
    for i, sc in enumerate(ep["scenes"]):
        sc = {k: v for k, v in sc.items() if k not in PLAN_NOTE_KEYS}
        if sc.get("kind") == "TODO":
            errors.append(f"scene {sc['id']}: kind is still TODO (scene plan not filled in)")
        if abs(sc["start"] - prev_end) > 0.05:
            errors.append(f"scene {sc['id']}: starts at {sc['start']} but previous ends at {prev_end}")
        if sc["end"] <= sc["start"]:
            errors.append(f"scene {sc['id']}: end <= start")
        prev_end = sc["end"]
        if sc["kind"] == "battle":
            resolve_battle(sc, ep, errors)
        if sc["kind"] == "map":
            resolve_map(sc, ep, assets, errors, terrain_used)
        if sc["kind"] == "image":
            asset_id = sc.pop("asset")
            img, prov = find_asset(images_dir, asset_id)
            check_generated(sc, prov, errors)
            if not prov.get("commercial_ok") and not sc.pop("licence_manually_reviewed", False):
                errors.append(f"scene {sc['id']}: licence not commercial-safe ({prov.get('licence_verdict')})")
            sc["src"] = str(img.relative_to(assets.resolve()) if img.is_absolute() and str(img).startswith(str(assets.resolve()))
                            else img.relative_to(assets))
            from PIL import Image
            with Image.open(img) as im:
                image_sizes[sc["id"]] = im.size
                sc["imageSize"] = list(im.size)
            iw, ih = image_sizes[sc["id"]]
            cover_zoom = max(1080 / iw, 1920 / ih) / min(1080 / iw, 1920 / ih)
            for k in sc.get("camera") or []:
                # zoom keywords: "fit" = whole image, "cover" = fills the 9:16 frame,
                # "cover*1.3" = 30% closer than cover
                z = k.get("zoom")
                if isinstance(z, str):
                    m = re.fullmatch(r"(fit|cover)(?:\*([\d.]+))?", z.strip())
                    if not m:
                        errors.append(f"scene {sc['id']}: bad camera zoom {z!r}")
                        continue
                    k["zoom"] = round((1.0 if m.group(1) == "fit" else cover_zoom) * float(m.group(2) or 1), 4)
            n_layers = sc.pop("depth_layers", None)
            if n_layers and not sc.get("camera"):
                # parallax needs the camera renderer: default = whole image, gentle push-in
                sc["camera"] = [{"t": sc["start"], "x": 0.5, "y": 0.5, "zoom": 1.0},
                                {"t": sc["end"], "x": 0.5, "y": 0.5, "zoom": 1.06}]
            if n_layers:
                sc["layers"] = ensure_layers(img, asset_id, images_dir, int(n_layers))
            for k in sc.get("camera") or []:
                if not (sc["start"] - 0.01 <= k["t"] <= sc["end"] + 0.4):
                    errors.append(f"scene {sc['id']}: camera key t={k['t']} outside the scene")
            if sc.get("fit") == "contain-blur" or sc.get("camera"):
                bg = images_dir / "_bg" / f"{asset_id}.jpg"
                make_backdrop(img, bg)
                sc["blurSrc"] = str(bg.relative_to(assets))
            label = sc.get("label")
            if not label:
                errors.append(f"scene {sc['id']}: image scene without on-screen label")
            elif not label.get("credit"):
                label["credit"] = default_credit({**prov, "credit_override": sc.pop("credit_author", None)})
            sc.pop("credit_author", None)
            credits.append((sc["id"], {**prov, "_label_title": (label or {}).get("title")},
                            label.get("credit") if label else ""))
        scenes_out.append(sc)
    if abs(prev_end - duration) > 0.5:
        errors.append(f"last scene ends at {prev_end} but narration is {duration:.2f}s")

    rules = episode_rules.validate(ep, project, duration, captions, image_sizes)
    for w in rules.warnings:
        print(f"WARNING {w}", file=sys.stderr)
    errors += rules.errors

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
    grain = ep.get("grain", 0.5 if int(ep.get("rules_version", 1)) >= 2 else 0)
    if grain:
        tiles = make_grain(assets / "fx")
        props["globalFx"] = {"grain": grain, "grainSrcs": [str(t.relative_to(assets)) for t in tiles]}

    out = project / "artifacts" / "props.json"
    out.write_text(json.dumps(props, indent=1, ensure_ascii=False))

    lines = [f"{ep.get('title', '')} — image and data credits", ""]
    seen: dict[str, list[str]] = {}
    for sid, prov, shown in credits:
        seen.setdefault(prov["title"], []).append(sid)
    done = set()
    for sid, prov, shown in credits:
        if prov["title"] in done:
            continue
        done.add(prov["title"])
        lines += [
            f"[{', '.join(seen[prov['title']])}] "
            f"{prov.get('_label_title') or clean_object_name(prov.get('object_name') or '') or prov['title']}",
            f"    Author/creator: {prov.get('author') or 'n/a'}",
            f"    Licence: {prov.get('licence')}  {prov.get('licence_url') or ''}".rstrip(),
            f"    Source: {prov.get('page_url') or 'generated locally — ' + str(prov.get('generator'))}",
        ]
        if prov.get("restrictions"):
            note = prov["restrictions"]
            if "ita-mibac" in note:
                note += (" (Italian cultural-heritage rules: commercial reproduction of Italian state-held"
                         " cultural property may need the managing institution's permission)")
            lines.append(f"    Restrictions noted on Commons: {note}")
        lines.append("")
    illus = [s["id"] for s in scenes_out if s["kind"] in ("illustration", "tactics", "map", "battle")]
    for extra in ep.get("extra_credits", []):
        lines.append(extra)
    for attribution in sorted(set(filter(None, terrain_used))):
        lines.append(f"Terrain relief (modern, smoothed): {attribution}.")
    lines += ["", f"Original maps, diagram and illustrations ({', '.join(illus)}): created for this video;"
              " coastlines from Natural Earth (public domain).",
              "Narration: supplied by the channel (ElevenLabs)."]
    (project / "CREDITS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(scenes_out)} scenes, {duration:.2f}s) and {project / 'CREDITS.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
