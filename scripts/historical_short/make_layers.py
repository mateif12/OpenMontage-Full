#!/usr/bin/env python3
"""Split a still (painting, photo, illustration) into depth layers for 2.5D parallax.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md). build_props.py
calls it for image scenes with ``depth_layers: 2|3``; results are cached.

How (all local, free):
  1. Relative depth with Depth-Anything-V2-Small (ONNX, Apache-2.0, ~99 MB,
     downloaded once from Hugging Face: onnx-community/depth-anything-v2-small)
     run by onnxruntime on the CPU (≈1-3 s per image).
  2. Depth is split at quantiles into far / (mid) / near; masks are feathered.
  3. The far layer is the original with the nearer regions filled by OpenCV
     inpainting, so parallax never reveals holes — only plausible background.
  4. Nearer layers are RGBA cut-outs of the ORIGINAL pixels (nothing is
     repainted or generated: the artwork's content is unchanged).

Outputs (in --out): bg.jpg, l1.png[, l2.png], layers.json, depth.jpg (review).

Usage:
    python scripts/historical_short/make_layers.py <image> --out <dir> [--layers 3]
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

# The Hugging Face Xet CDN is blocked in many sandboxes; use plain HTTPS.
# Must be set before huggingface_hub is imported.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

MODEL_REPO = "onnx-community/depth-anything-v2-small"
MODEL_FILE = "onnx/model.onnx"


def depth_map(img: Image.Image) -> np.ndarray:
    """Relative inverse depth in [0, 1] (1 = nearest), same size as img."""
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    model = hf_hub_download(MODEL_REPO, MODEL_FILE)
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    # long side 518, both sides multiples of 14 (ViT patch size)
    w, h = img.size
    sc = 518 / max(w, h)
    tw, th = max(14, round(w * sc / 14) * 14), max(14, round(h * sc / 14) * 14)
    x = np.asarray(img.convert("RGB").resize((tw, th), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    x = x.transpose(2, 0, 1)[None]
    name = sess.get_inputs()[0].name
    d = sess.run(None, {name: x})[0]
    d = np.squeeze(d).astype(np.float32)
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    d = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    return np.asarray(Image.fromarray((d * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC),
                      dtype=np.float32) / 255.0


def soft_mask(depth: np.ndarray, thr: float, feather: float = 0.05) -> np.ndarray:
    import cv2
    m = np.clip((depth - (thr - feather)) / (2 * feather), 0, 1)
    # remove speckles, then soften edges a little
    k = max(3, int(min(depth.shape) * 0.006) | 1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    return cv2.GaussianBlur(m, (k * 2 + 1, k * 2 + 1), 0)


def fill_background(rgb: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """Inpaint the (dilated) near regions at reduced size, composite back."""
    import cv2
    h, w = hole.shape
    k = max(5, int(min(h, w) * 0.025) | 1)
    hole_d = cv2.dilate((hole > 0.15).astype(np.uint8), np.ones((k, k), np.uint8))
    scale = min(1.0, 700 / max(h, w))
    small = cv2.resize(rgb, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    small_hole = cv2.resize(hole_d, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    filled = cv2.inpaint(small, small_hole, 9, cv2.INPAINT_TELEA)
    filled = cv2.GaussianBlur(filled, (7, 7), 0)
    up = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(hole_d.astype(np.float32), (k * 2 + 1, k * 2 + 1), 0)[..., None]
    return (rgb * (1 - a) + up * a).astype(np.uint8)


def make_layers(image: Path, out: Path, n_layers: int = 3) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    img = Image.open(image).convert("RGB")
    rgb = np.asarray(img)
    d = depth_map(img)
    Image.fromarray((d * 255).astype(np.uint8)).save(out / "depth.jpg", quality=85)
    if n_layers >= 3:
        q_mid, q_near = np.percentile(d, 45), np.percentile(d, 72)
        near = soft_mask(d, q_near)
        mid = np.maximum(soft_mask(d, q_mid), near)
        # the mid layer's pixels behind the near layer are filled too, so the
        # near layer's drift never shows a doubled ("ghost") copy of itself
        cut = [(mid, 0.45, "l1.png", fill_background(rgb, near)), (near, 1.0, "l2.png", rgb)]
        hole = mid
    else:
        near = soft_mask(d, np.percentile(d, 62))
        cut = [(near, 1.0, "l1.png", rgb)]
        hole = near
    Image.fromarray(fill_background(rgb, hole)).save(out / "bg.jpg", quality=92)
    layers = [{"src": "bg.jpg", "depth": 0.0}]
    for mask, depth, name, pixels in cut:
        rgba = np.dstack([pixels, (mask * 255).astype(np.uint8)])
        Image.fromarray(rgba, "RGBA").save(out / name, optimize=False, compress_level=3)
        layers.append({"src": name, "depth": depth})
    (out / "layers.json").write_text(json.dumps({"source": str(image), "layers": layers,
                                                 "model": f"{MODEL_REPO} ({MODEL_FILE}, Apache-2.0)"}, indent=1))
    return layers


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--layers", type=int, default=3, choices=[2, 3])
    a = ap.parse_args()
    for layer in make_layers(Path(a.image), Path(a.out), a.layers):
        print(layer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
