"""Historical-short Phase 2: camera honesty rules and layer helpers (no network, no model)."""
import numpy as np
import pytest

import episode_rules
import make_layers


def test_visible_fraction():
    # landscape 2:1 painting: zoom 1 = whole image visible
    assert episode_rules.visible_fraction(2000, 1000, 1.0) == pytest.approx(1.0)
    assert episode_rules.visible_fraction(2000, 1000, 2.0) == pytest.approx(0.5)
    # portrait 9:16 fits the frame exactly
    assert episode_rules.visible_fraction(1080, 1920, 1.0) == pytest.approx(1.0)


def _scene(keys, tag="PAINTING", sid="s1", asset="a1"):
    return {"id": sid, "kind": "image", "start": 0, "end": 4, "asset": asset, "camera": keys,
            "label": {"tag": tag, "title": "x"}}


def test_detail_needs_label_and_full_reveal():
    rep = episode_rules.Report()
    ep = {"scenes": [_scene([{"t": 0, "x": .5, "y": .5, "zoom": 2.5}, {"t": 4, "x": .5, "y": .5, "zoom": 2.5}])]}
    episode_rules.check_camera_honesty(ep, {"s1": (2000, 1000)}, rep)
    text = " ".join(rep.warnings)
    assert "DETAIL" in text and "only ever shown cropped" in text


def test_detail_ok_when_labelled_and_revealed():
    rep = episode_rules.Report()
    ep = {"scenes": [
        _scene([{"t": 0, "x": .5, "y": .5, "zoom": 2.5}, {"t": 4, "x": .5, "y": .5, "zoom": 2.5}], tag="PAINTING · DETAIL"),
        _scene([{"t": 4, "x": .5, "y": .5, "zoom": 1.0}, {"t": 8, "x": .5, "y": .5, "zoom": 1.05}], sid="s2"),
    ]}
    episode_rules.check_camera_honesty(ep, {"s1": (2000, 1000), "s2": (2000, 1000)}, rep)
    assert not rep.warnings


def test_soft_upscale_warning():
    rep = episode_rules.Report()
    ep = {"scenes": [_scene([{"t": 0, "x": .5, "y": .5, "zoom": 1.0}, {"t": 4, "x": .5, "y": .5, "zoom": 3.0}],
                            tag="DETAIL")]}
    episode_rules.check_camera_honesty(ep, {"s1": (800, 400)}, rep)
    assert any("enlarges the source" in w for w in rep.warnings)


def test_layer_masks_and_fill():
    pytest.importorskip("cv2")
    depth = np.tile(np.linspace(0, 1, 200, dtype=np.float32)[:, None], (1, 300))  # near at the bottom
    m = make_layers.soft_mask(depth, 0.7)
    assert m.shape == depth.shape and m[-1].mean() > 0.95 and m[0].mean() < 0.05
    rgb = np.zeros((200, 300, 3), np.uint8)
    rgb[:100] = (40, 80, 160)   # "sky"
    rgb[100:] = (200, 30, 30)   # "foreground"
    filled = make_layers.fill_background(rgb, (depth > 0.6).astype(np.float32))
    assert filled.shape == rgb.shape
    # the hole (bottom) is filled from the surrounding content, not left black
    assert filled[-5:].mean() > 20
