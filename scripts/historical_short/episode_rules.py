#!/usr/bin/env python3
"""Pre-render checks for historical-short episodes (no rendering needed).

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Two groups of checks, both computed from the episode file + captions + image
sizes, so layout problems are caught before any frame is rendered:

  * Storytelling rules — maps/diagrams support the story, they must not carry
    it: limited share of runtime, never back-to-back, never the main visual of
    a narrated combat beat, image scenes not too long.
  * Layout — paintings above the caption block, map labels inside the frame
    and clear of captions/title, label text length.

Episodes with ``rules_version: 2`` (the template default) fail on rule
errors; older episodes (e.g. battle-of-cannae, rules_version absent) only get
warnings, so they keep building unchanged.

Usage (also called by build_props.py):
    python scripts/historical_short/episode_rules.py --episode <ep.yaml> --project projects/<id>
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

W, H = 1080, 1920

# Words that mark a narrated combat beat (the visual should show the fighting,
# not a map). Kept generic so it works for any period.
COMBAT_WORDS = re.compile(
    r"\b(attack\w*|charg\w*|assault\w*|storm\w*|fight\w*|fought|clash\w*|"
    r"battles?\b(?!\s+of\b)|"
    r"volley|fir(e|ed|ing)|cannon\w*|artillery|cavalry|infantry|bayonet\w*|melee|"
    r"slaughter\w*|massacre\w*|besieg\w*|siege|broke|collaps\w*|rout\w*|"
    r"retreat\w*|overr\w*|crush\w*|struggl\w*|brutal)\b",
    re.I,
)

DEFAULT_LIMITS = {
    "map_share_max": 0.25,       # map + tactics seconds / runtime
    "map_scene_max_s": 7.0,      # one map scene
    "image_scene_max_s": 8.0,    # one still without camera keyframes
    "label_title_max_chars": 72,
    "combat_map_overlap_max": 0.5,  # share of a combat sentence a map may cover
}

DIAGRAM_KINDS = ("map", "tactics")


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add(self, strict: bool, msg: str) -> None:
        (self.errors if strict else self.warnings).append(msg)


# --- geometry helpers ---------------------------------------------------------

def caption_box(caption_style: dict | None) -> tuple[float, float]:
    """(top, bottom) y of the caption block in px. Mirrors HistoricalShort.tsx:
    captions are centred in a box of height 1920 - bottomOffset; up to 2 lines."""
    cs = caption_style or {}
    font = cs.get("fontSize", 60)
    bottom_offset = cs.get("bottomOffset", 470)
    # Measured on the Waterloo render (defaults): the caption block is
    # bottom-anchored at ≈1365 px (= 0.94 × the 1450 px caption container);
    # two lines span ≈1177-1365 px.
    bottom = (H - bottom_offset) * 0.94
    block_h = 2 * font * 1.3 + 40
    return bottom - block_h, bottom


def ease_in_out_cubic(p: float) -> float:
    p = max(0.0, min(1.0, p))
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def camera_at(keys: list[dict], t: float) -> dict:
    """Same interpolation as MapSceneView.cameraAt."""
    if t <= keys[0]["t"]:
        return keys[0]
    for a, b in zip(keys, keys[1:]):
        if t <= b["t"]:
            p = ease_in_out_cubic((t - a["t"]) / max(0.001, b["t"] - a["t"]))
            span = math.exp(math.log(a["span"]) + (math.log(b["span"]) - math.log(a["span"])) * p)
            return {"lon": a["lon"] + (b["lon"] - a["lon"]) * p, "lat": a["lat"] + (b["lat"] - a["lat"]) * p,
                    "span": span}
    return keys[-1]


def project(cam: dict, kx: float, lon: float, lat: float) -> tuple[float, float]:
    x = (lon - cam["lon"]) / cam["span"] * W + W / 2
    y = (cam["lat"] - lat) / (cam["span"] * kx) * W + H / 2
    return x, y


def image_band(img_w: int, img_h: int, zoom: float, pan_y: float) -> tuple[float, float]:
    """Vertical extent (top, bottom) of a contain-fitted image in the frame."""
    scale = min(W / img_w, H / img_h)
    h = img_h * scale * zoom
    cy = H / 2 + pan_y
    return cy - h / 2, cy + h / 2


# --- checks -------------------------------------------------------------------

def sentence_spans(captions: dict) -> list[tuple[float, float, str]]:
    return [(s["startMs"] / 1000, s["endMs"] / 1000, s["text"]) for s in captions.get("sentences", [])]


def overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def check_story(ep: dict, duration: float, captions: dict, strict: bool, rep: Report) -> None:
    lim = {**DEFAULT_LIMITS, **(ep.get("rules") or {})}
    scenes = ep["scenes"]
    diag = [s for s in scenes if s["kind"] in DIAGRAM_KINDS]
    share = sum(s["end"] - s["start"] for s in diag) / max(duration, 0.001)
    if share > lim["map_share_max"]:
        rep.add(strict, f"maps/diagrams fill {share:.0%} of the runtime (max {lim['map_share_max']:.0%}); "
                        "use paintings, animated details or battle illustrations for more beats")
    for a, b in zip(scenes, scenes[1:]):
        if a["kind"] in DIAGRAM_KINDS and b["kind"] in DIAGRAM_KINDS:
            rep.add(strict, f"{a['id']} and {b['id']}: two map/diagram scenes in a row")
    for s in diag:
        if s["end"] - s["start"] > lim["map_scene_max_s"] + 1e-6 and s["kind"] == "map":
            rep.add(strict, f"{s['id']}: map scene lasts {s['end'] - s['start']:.1f}s "
                            f"(max {lim['map_scene_max_s']}s)")
    for s in scenes:
        if s["kind"] == "image" and not s.get("camera") and s["end"] - s["start"] > lim["image_scene_max_s"]:
            rep.warnings.append(f"{s['id']}: still image for {s['end'] - s['start']:.1f}s without camera "
                                "keyframes — add a camera path or split the beat")
    # combat sentences must be carried by a battle visual, not a map
    for t0, t1, text in sentence_spans(captions):
        if not COMBAT_WORDS.search(text):
            continue
        dur = max(0.001, t1 - t0)
        diag_cover = sum(overlap(t0, t1, s["start"], s["end"]) for s in diag if not s.get("allow_for_combat"))
        if diag_cover / dur > lim["combat_map_overlap_max"]:
            rep.add(strict, f"combat beat shown mainly as a map/diagram ({diag_cover / dur:.0%}): \"{text}\" "
                            f"[{t0:.2f}-{t1:.2f}s] — use a battle painting, detail shot or battle illustration "
                            "(set allow_for_combat: true on the scene only if a diagram is truly the best visual)")


def check_labels(ep: dict, rep: Report) -> None:
    lim = {**DEFAULT_LIMITS, **(ep.get("rules") or {})}
    for s in ep["scenes"]:
        lab = s.get("label") or {}
        if len(lab.get("title", "")) > lim["label_title_max_chars"]:
            rep.warnings.append(f"{s['id']}: label title is {len(lab['title'])} chars (max "
                                f"{lim['label_title_max_chars']}) — it will wrap onto 3 lines")


def check_image_layout(ep: dict, images: dict[str, tuple[int, int]], rep: Report) -> None:
    cap_top, _ = caption_box(ep.get("caption_style"))
    for s in ep["scenes"]:
        if s["kind"] != "image" or s.get("fit", "cover") != "contain-blur" or s.get("camera"):
            continue
        size = images.get(s["id"])
        if not size:
            continue
        pan = s.get("panY") or [0, 0]
        top, bottom = image_band(size[0], size[1], max(s.get("zoomFrom", 1.04), s.get("zoomTo", 1.12)),
                                 max(pan))
        if size[0] / size[1] > 1.15 and bottom > cap_top + 20:
            need = bottom - cap_top + 20
            rep.warnings.append(f"{s['id']}: painting extends {need:.0f}px under the captions "
                                f"(add panY: [{-round(need)}, {-round(need)}] or use a camera path)")


def visible_fraction(iw: int, ih: int, zoom: float) -> float:
    """Share of the image area inside the frame at a camera zoom (zoom 1 = contain)."""
    s = min(W / iw, H / ih) * zoom
    return min(1.0, W / (iw * s)) * min(1.0, H / (ih * s))


def check_camera_honesty(ep: dict, images: dict[str, tuple[int, int]], rep: Report) -> None:
    """Cropped (detail) views must say so; each artwork should be seen whole once."""
    shown_whole: set[str] = set()
    cropped: dict[str, str] = {}
    for s in ep["scenes"]:
        if s["kind"] != "image":
            continue
        size = images.get(s["id"])
        keys = s.get("camera") or []
        if not keys or not size:
            if s.get("fit", "cover") == "contain-blur" or s.get("depth_layers"):
                shown_whole.add(s.get("asset"))
            continue
        iw, ih = size
        vis = [visible_fraction(iw, ih, k["zoom"]) for k in keys]
        up = max(min(W / iw, H / ih) * k["zoom"] for k in keys)
        if up > 2.2:
            rep.warnings.append(f"{s['id']}: camera enlarges the source {up:.1f}x (soft) — fetch a larger "
                                "version (fetch_commons --max-width 3840) or zoom less")
        if max(vis) >= 0.92:
            shown_whole.add(s.get("asset"))
        if min(vis) < 0.8:
            cropped[s.get("asset")] = s["id"]
            tag = ((s.get("label") or {}).get("tag") or "").upper()
            if "DETAIL" not in tag and vis[-1] < 0.8:
                rep.warnings.append(f"{s['id']}: camera shows only {min(vis):.0%} of the image — add 'DETAIL' to "
                                    "the label tag or end on the whole image")
    for asset, sid in cropped.items():
        if asset not in shown_whole and "photo" not in str(asset).lower():
            rep.warnings.append(f"{sid}: artwork '{asset}' is only ever shown cropped — reveal the complete "
                                "painting once (a camera key with zoom 1) where appropriate")


def _label_box(x: float, y: float, text: str, side: str, size: float = 32) -> tuple[float, float, float, float]:
    w = len(text) * size * 0.56
    off = 22
    if side == "left":
        return x - off - w, y - size, x - off, y + size * 0.4
    if side == "right":
        return x + off, y - size, x + off + w, y + size * 0.4
    if side == "above":
        return x - w / 2, y - off - size, x + w / 2, y - off
    return x - w / 2, y + off, x + w / 2, y + off + size * 1.3


def check_map_layout(ep: dict, project_dir: Path, captions: dict, rep: Report) -> None:
    assets = project_dir / "assets"
    cap_top, cap_bot = caption_box(ep.get("caption_style"))
    words = captions.get("words", [])

    def caption_visible(t: float) -> bool:
        return any(w["startMs"] / 1000 - 0.1 <= t <= w["endMs"] / 1000 + 0.6 for w in words)

    for s in ep["scenes"]:
        if s["kind"] != "map" or not s.get("camera"):
            continue
        bm = assets / s.get("basemap", "")
        kx = json.loads(bm.read_text())["kx"] if bm.is_file() else math.cos(math.radians(s["camera"][0]["lat"]))
        tj = assets / s["terrain"] if s.get("terrain") else None
        if tj is not None and tj.is_file():
            w_, s_, e_, n_ = json.loads(tj.read_text())["bbox"]
            for k in s["camera"]:
                half_lon = k["span"] / 2
                half_lat = k["span"] * kx * H / W / 2
                if k["lon"] - half_lon < w_ or k["lon"] + half_lon > e_ or k["lat"] - half_lat < s_ or k["lat"] + half_lat > n_:
                    need = [round(k["lon"] - half_lon, 3), round(k["lat"] - half_lat, 3),
                            round(k["lon"] + half_lon, 3), round(k["lat"] + half_lat, 3)]
                    rep.warnings.append(f"{s['id']}: camera at t={k['t']} sees beyond the terrain relief "
                                        f"(bbox {[w_, s_, e_, n_]}); rebuild with build_terrain.py --bbox covering {need}")
                    break
        items = [(m["lon"], m["lat"], m["label"], m.get("labelSide", "right"), m["at"]) for m in s.get("markers", [])]
        issues: dict[str, str] = {}
        t = s["start"]
        while t <= s["end"] - 0.25:
            cam = camera_at(s["camera"], t)
            for lon, lat, text, side, at in items:
                if t < at + 0.4 or text in issues:
                    continue
                x, y = project(cam, kx, lon, lat)
                if not (-40 <= x <= W + 40 and -40 <= y <= H + 40):
                    continue  # marker itself off-screen (intended during camera moves)
                # mirror MapSceneView: left/right labels flip to stay inside the frame
                lw = len(text) * 32 * 0.56 + 22
                if side == "right" and x + lw > W - 12:
                    side = "left"
                elif side == "left" and x - lw < 12:
                    side = "right"
                x0, y0, x1, y1 = _label_box(x, y, text, side)
                if x0 < 12 or x1 > W - 12:
                    issues[text] = f"label clipped at the frame edge at t={t:.1f}s (labelSide '{side}')"
                elif caption_visible(t) and y1 > cap_top and y0 < cap_bot:
                    issues[text] = f"label under the captions at t={t:.1f}s"
            t += 0.5
        for text, msg in issues.items():
            rep.warnings.append(f"{s['id']}: marker '{text}': {msg}")


def validate(ep: dict, project_dir: Path, duration: float, captions: dict,
             image_sizes: dict[str, tuple[int, int]] | None = None) -> Report:
    strict = int(ep.get("rules_version", 1)) >= 2
    rep = Report()
    check_story(ep, duration, captions, strict, rep)
    check_labels(ep, rep)
    check_image_layout(ep, image_sizes or {}, rep)
    check_camera_honesty(ep, image_sizes or {}, rep)
    check_map_layout(ep, project_dir, captions, rep)
    return rep


def main() -> int:
    import yaml
    from PIL import Image
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--episode", required=True)
    ap.add_argument("--project", required=True)
    a = ap.parse_args()
    ep = yaml.safe_load(Path(a.episode).read_text())
    project = Path(a.project)
    captions = json.loads((project / "artifacts" / "captions.json").read_text())
    import subprocess
    duration = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
         str(project / "assets" / ep["narration"])], capture_output=True, text=True, check=True).stdout)
    sizes = {}
    img_dir = project / "assets" / ep.get("images_dir", "images")
    for s in ep["scenes"]:
        if s["kind"] == "image":
            prov = img_dir / f"{s['asset']}.provenance.json"
            if prov.exists():
                p = json.loads(prov.read_text())
                lp = Path(p["local_path"])
                lp = lp if lp.is_absolute() else Path.cwd() / lp
                if lp.exists():
                    sizes[s["id"]] = Image.open(lp).size
    rep = validate(ep, project, duration, captions, sizes)
    for e in rep.errors:
        print("ERROR  ", e)
    for w in rep.warnings:
        print("WARNING", w)
    print(f"{len(rep.errors)} errors, {len(rep.warnings)} warnings")
    return 2 if rep.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
