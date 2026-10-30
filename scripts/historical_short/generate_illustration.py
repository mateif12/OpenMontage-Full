#!/usr/bin/env python3
"""Local AI painting pass over a code-drawn battle plate (free, offline after download).

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

Why image-to-image over our own plate: on CPU the only practical model
(LCM-Dreamshaper-v7, OpenVINO int8, ~2.3 GB) follows text prompts poorly —
measured 2026-10-30: asked for an infantry line it drew cavalry; asked for an
artillery battery it fused a rider with a gun carriage. So the COMPOSITION
(who, where, uniform colours, headgear, weapons) comes from the period-aware
code-drawn BattleSceneView plate, and the model only repaints it with painterly
light and texture at moderate strength. FLUX.1-schnell (better prompts) was
OOM-killed on this 15 GB machine, so it is not used.

Steps:
  1. render the clean plate of a `battle` scene (no labels/captions) at --at
  2. prompt = period kit ai.style + ai.positive + scene description;
     negative = kit anachronisms
  3. OpenVINO GenAI Image2ImagePipeline, CPU, ≈45-60 s per 576x1024 image
  4. images/<id>.png + <id>.provenance.json (generated: true, model, prompt,
     seed, plate) with review.status = "pending"
  5. the agent MUST look at the result and record an accuracy review:
       generate_illustration.py review --project ... --id <id> --approve --notes "..."
     build_props.py refuses generated images that are not approved, and their
     label must say AI (e.g. "AI-ASSISTED ILLUSTRATION · ARTISTIC INTERPRETATION").

Usage:
    python scripts/historical_short/generate_illustration.py paint --project projects/<id> \
        --scene s05 --at 20.4 --id ai_volley [--strength 0.5] [--seed 7] [--extra "..."]
    python scripts/historical_short/generate_illustration.py review --project projects/<id> \
        --id ai_volley --approve --notes "shakos, crossbelts, flintlocks correct; no anachronisms"
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

MODEL_REPO = "OpenVINO/LCM_Dreamshaper_v7-int8-ov"
MODEL_NOTE = ("OpenVINO/LCM_Dreamshaper_v7-int8-ov (Hugging Face licence tag: MIT; derived from "
              "SimianLuo/LCM_Dreamshaper_v7) run locally with OpenVINO GenAI on CPU")
GEN_W, GEN_H = 576, 1024
CHROMIUM = Path("/opt/pw-browsers/chromium")


def render_plate(project: Path, scene: dict, props: dict, at: float, out: Path) -> Path:
    """Render the scene alone (plate mode) at absolute time `at`, re-timed to start at 0."""
    off = scene["start"]
    plate_scene = {k: v for k, v in scene.items() if k not in ("label", "fx", "transition")}
    plate_scene.update(start=0.0, end=scene["end"] - off)
    if plate_scene.get("fireAt"):
        plate_scene["fireAt"] = [f - off for f in plate_scene["fireAt"]]
    plate_props = {"durationSeconds": round(scene["end"] - off, 3), "narrationSrc": props["narrationSrc"],
                   "scenes": [plate_scene], "captions": [], "plate": True}
    pp = out.with_suffix(".plate_props.json")
    pp.write_text(json.dumps(plate_props))
    tmp = out.parent / "_plate"
    if CHROMIUM.exists():
        os.environ.setdefault("REMOTION_BROWSER_EXECUTABLE", str(CHROMIUM))
    subprocess.run(["node", str(HERE / "preview_stills.mjs"), str(pp), str(project / "assets"), str(tmp), "1",
                    str(round(at - off, 3))], check=True, cwd=REPO / "remotion-composer", capture_output=True)
    src = next(tmp.glob("t*.jpg"))
    src.replace(out)
    tmp.rmdir()
    pp.unlink(missing_ok=True)
    return out


def color_lock(ai_img, plate_img, amount: float = 0.8):
    """Keep the AI pass's light and texture (Lab L) but restore the plate's
    colours (Lab a/b) so uniform colours stay exactly those of the period kit."""
    import cv2
    import numpy as np
    from PIL import Image
    ai = cv2.cvtColor(np.asarray(ai_img.convert("RGB")), cv2.COLOR_RGB2LAB).astype(np.float32)
    pl = np.asarray(plate_img.convert("RGB").resize(ai_img.size, Image.LANCZOS))
    pl = cv2.cvtColor(cv2.GaussianBlur(pl, (5, 5), 0), cv2.COLOR_RGB2LAB).astype(np.float32)
    ai[..., 1:] = ai[..., 1:] * (1 - amount) + pl[..., 1:] * amount
    return Image.fromarray(cv2.cvtColor(ai.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB))


def describe(scene: dict, kit: dict) -> str:
    import build_props
    what = build_props.TEMPLATE_TITLES.get(scene["template"], "battle scene").lower()
    sides = []
    for side in ("left", "right"):
        f = (scene.get(side) or {}).get("faction") or {}
        if f.get("label"):
            sides.append(f["label"])
    return f"{what}, {' facing '.join(sides)}" if sides else what


def paint(a: argparse.Namespace) -> int:
    import numpy as np
    import openvino as ov
    import openvino_genai as g
    import yaml
    from huggingface_hub import snapshot_download
    from PIL import Image, ImageFilter

    import periods
    project = Path(a.project).resolve()
    props = json.loads((project / "artifacts" / "props.json").read_text())
    scene = next((s for s in props["scenes"] if s["id"] == a.scene), None)
    if not scene or scene.get("kind") != "battle":
        raise SystemExit(f"{a.scene}: not a battle scene in props.json (run build_props.py first)")
    kit = periods.load_kit(scene["kit"]["id"])
    ai = kit.get("ai", {})
    images = project / "assets" / "images"
    images.mkdir(parents=True, exist_ok=True)
    plate = render_plate(project, scene, props, a.at, images / f"{a.id}.plate.jpg")

    prompt = ", ".join(x for x in [ai.get("style"), describe(scene, kit), ai.get("positive"), a.extra] if x)
    negative = ai.get("negative", "")
    t0 = time.time()
    pipe = g.Image2ImagePipeline(snapshot_download(MODEL_REPO), "CPU")
    init = Image.open(plate).convert("RGB").resize((GEN_W, GEN_H), Image.LANCZOS)
    kwargs = dict(image=ov.Tensor(np.asarray(init)[None]), strength=a.strength,
                  num_inference_steps=a.steps, rng_seed=a.seed)
    try:
        res = pipe.generate(prompt, negative_prompt=negative, **kwargs)
    except Exception:  # LCM ignores CFG / negative prompts in some versions
        res = pipe.generate(prompt, **kwargs)
    img = Image.fromarray(res.data[0]).resize((1080, 1920), Image.LANCZOS)
    if a.color_lock > 0:
        img = color_lock(img, Image.open(plate), a.color_lock)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2))
    dest = images / f"{a.id}.png"
    img.save(dest)
    prov = {
        "asset_id": a.id, "local_path": str(dest), "title": f"AI-assisted illustration: {describe(scene, kit)}",
        "generated": True, "generator": MODEL_NOTE, "method": "image-to-image over a code-drawn period plate",
        "base_plate": str(plate), "scene": a.scene, "plate_time": a.at, "period": kit["id"],
        "prompt": prompt, "negative_prompt": negative, "strength": a.strength, "steps": a.steps, "seed": a.seed,
        "color_lock": a.color_lock,
        "seconds": round(time.time() - t0, 1),
        "author": "Original illustration created for this channel (local AI-assisted)",
        "licence": "Original work", "commercial_ok": True, "licence_verdict": "original work",
        "page_url": None, "object_name": None,
        "review": {"status": "pending", "checklist": [
            "headgear, coats, belts and weapons match the period kit (and the narration)",
            "no anachronisms (modern weapons, wrong era armour, text, logos)",
            "no malformed people/horses in prominent positions",
            "nothing that misrepresents a specific real event, unit or person"]},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (images / f"{a.id}.provenance.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    print(f"saved {dest} in {prov['seconds']}s — LOOK AT IT, then record the review:\n"
          f"  python {Path(__file__).relative_to(REPO)} review --project {project} --id {a.id} "
          f"--approve|--reject --notes \"...\"")
    return 0


def review(a: argparse.Namespace) -> int:
    pp = Path(a.project) / "assets" / "images" / f"{a.id}.provenance.json"
    prov = json.loads(pp.read_text())
    if not prov.get("generated"):
        raise SystemExit("not a generated image")
    if not a.notes or len(a.notes) < 15:
        raise SystemExit("--notes must say what was checked (uniforms, weapons, anachronisms, anatomy)")
    prov["review"].update({"status": "approved" if a.approve else "rejected", "notes": a.notes,
                           "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    pp.write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    print(f"{a.id}: {prov['review']['status']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("paint")
    p.add_argument("--project", required=True)
    p.add_argument("--scene", required=True)
    p.add_argument("--at", type=float, required=True, help="absolute time of the plate frame")
    p.add_argument("--id", required=True)
    # measured: 0.5 repaints content (infantry -> riders, wrong coat colours); 0.3 keeps the plate's
    # composition and adds painterly light/texture
    p.add_argument("--strength", type=float, default=0.3)
    p.add_argument("--steps", type=int, default=8)
    p.add_argument("--color-lock", type=float, default=0.8,
                   help="0..1: restore the plate's (period-kit) colours under the AI texture")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--extra", default="")
    p = sub.add_parser("review")
    p.add_argument("--project", required=True)
    p.add_argument("--id", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--approve", action="store_true")
    g.add_argument("--reject", action="store_true")
    p.add_argument("--notes", required=True)
    a = ap.parse_args()
    return paint(a) if a.cmd == "paint" else review(a)


if __name__ == "__main__":
    raise SystemExit(main())
