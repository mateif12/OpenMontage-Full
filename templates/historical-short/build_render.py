"""Build the pipeline artifacts of a historical Short and render it with Remotion.

Inputs (produced by the earlier template steps):
  artifacts/short_config.json      title, hook, scenes, grades, caption style
  artifacts/shot_list.json         shots: archive record, source in-point, framing
  artifacts/narration_layout.json  narration segments on the timeline
  artifacts/caption_words.json     word timings mapped onto the script
  assets/video/<shot>.mp4 + .provenance.json, assets/audio/narration.wav

Writes schema-validated brief / script / scene_plan / asset_manifest /
edit_decisions artifacts, renders renders/<name>.mp4 through video_compose
(runtime "remotion", profile "youtube_shorts"), and with --checkpoints
records the stage checkpoints (edit left awaiting human review).

Set REMOTION_BROWSER_EXECUTABLE to a local Chrome/Chromium when Remotion
cannot download its own headless shell.

Usage: .venv/bin/python templates/historical-short/build_render.py <project> <name>
           [--checkpoints] [--dry-run]
"""
import json
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from lib.checkpoint import write_checkpoint  # noqa: E402
from tools.video.video_compose import VideoCompose  # noqa: E402

P = Path(sys.argv[1]).resolve()
NAME = sys.argv[2] if len(sys.argv) > 2 else "draft"
FPS = 30


def load(name):
    return json.loads((P / "artifacts" / name).read_text())


def validate(name, obj):
    schema = json.loads((ROOT / "schemas" / "artifacts" / f"{name}.schema.json").read_text())
    jsonschema.validate(obj, schema)
    (P / "artifacts" / f"{name}.json").write_text(json.dumps(obj, indent=2))
    return obj


cfg = load("short_config.json")
shots = load("shot_list.json")["shots"]
layout = load("narration_layout.json")
words = load("caption_words.json")
total = layout["total_seconds"]
seg_text = {s["id"]: s["caption"] for s in layout["segments"]}

# Timeline sanity: contiguous, whole frames, ends with the narration.
prev = 0.0
for s in shots:
    assert abs(s["t0"] - prev) < 1e-6, f"gap/overlap before {s['id']}"
    for t in (s["t0"], s["t1"]):
        assert abs(t * FPS - round(t * FPS)) < 0.01, f"{s['id']}: {t}s is not a whole frame"
    prev = s["t1"]
assert abs(shots[-1]["t1"] - total) < 1 / FPS + 1e-6, (shots[-1]["t1"], total)

brief = validate("brief", {
    "version": "1.0",
    "title": cfg["title"],
    "hook": cfg["hook"],
    "key_points": [sc["title"] for sc in cfg["scenes"]],
    "tone": cfg["tone"],
    "style": cfg["style"],
    "target_platform": "youtube",
    "target_duration_seconds": cfg["target_duration_seconds"],
    "metadata": {
        "format": "YouTube Short, 1080x1920, 30 fps, H.264",
        "thematic_question": cfg["thematic_question"],
        "music_plan": cfg["music"],
        "end_tag_plan": {"mode": "overlay", "text": "Archive credit on the final shot"},
        "narration_plan": {"voice": f"Piper {cfg['voice']['name']} (local, free)", "language": "en"},
        "footage_policy": cfg["footage_policy"],
    },
})

script = validate("script", {
    "version": "1.0",
    "title": cfg["title"],
    "total_duration_seconds": total,
    "sections": [
        {"id": s["id"], "text": s["caption"], "start_seconds": s["start"], "end_seconds": s["end"],
         "speaker_directions": "Measured documentary read"
         + (f"; spoken text respelled for TTS: {s['spoken']!r}" if s["spoken"] != s["caption"] else "")}
        for s in layout["segments"]
    ],
})

scene_plan = validate("scene_plan", {
    "version": "1.0",
    "scenes": [
        {"id": sc["id"], "type": "broll",
         "description": f"{sc['title']}. Narration: " + " ".join(seg_text[x] for x in sc["segments"]),
         "start_seconds": min(s["t0"] for s in shots if s["scene"] == sc["id"]),
         "end_seconds": max(s["t1"] for s in shots if s["scene"] == sc["id"])}
        for sc in cfg["scenes"]
    ],
})

assets = []
for s in shots:
    prov = json.loads((P / "assets" / "video" / f"{s['id']}.provenance.json").read_text())
    assets.append({
        "id": f"clip_{s['id']}", "type": "video", "path": f"assets/video/{s['id']}.mp4",
        "source_tool": "remote_clip", "scene_id": s["scene"],
        "provider": prov.get("source", "archive"),
        "license": f"Use restriction: {prov['rights_status']}",
        "original_url": prov["media_url"], "duration_seconds": round(s["t1"] - s["t0"], 3),
        "resolution": "1080x1920", "format": "mp4",
        # Full provenance lives in assets/video/<shot>.provenance.json.
        "generation_summary": (
            f"{prov['record_id']} ({prov['catalog_url']}) source "
            f"{prov['source_in_seconds']:.2f}-{prov['source_out_seconds']:.2f}s; "
            f"use {prov['rights_status']}, access {prov['access_status']}"
        ),
    })
assets.append({"id": "narration", "type": "narration", "path": "assets/audio/narration.wav",
               "source_tool": "piper_tts", "scene_id": "all", "provider": "piper",
               "model": cfg["voice"]["name"], "license": cfg["voice"]["model_card"]})
asset_manifest = validate("asset_manifest", {"version": "1.0", "assets": assets})

replace = cfg.get("caption_display_replacements", {})
caption_words = [
    {"word": replace.get(w["word"], w["word"]), "startMs": w["startMs"], "endMs": w["endMs"],
     "pageBreakAfter": w["pageBreakAfter"]}
    for w in words
]

scenes = []
for i, s in enumerate(shots):
    dur = round(s["t1"] - s["t0"], 4)
    scenes.append({
        "id": s["id"], "kind": "video", "src": str(P / "assets" / "video" / f"{s['id']}.mp4"),
        "startSeconds": s["t0"], "durationSeconds": dur,
        "trimBeforeSeconds": 0, "trimAfterSeconds": dur,
        # Remotion layers a tone gradient and vignette over every shot; the
        # per-grade CSS filter lifts darker reels so they stay readable.
        "tone": "neutral", "filter": cfg["css_grades"][s["grade"]],
        # Hard cuts; only the very end fades out.
        "fadeInFrames": 0, "fadeOutFrames": 24 if i == len(shots) - 1 else 0,
    })

edit_decisions = validate("edit_decisions", {
    "version": "1.0",
    "render_runtime": "remotion",
    "renderer_family": "documentary-montage",
    "cuts": [{"id": s["id"], "source": f"clip_{s['id']}", "in_seconds": 0,
              "out_seconds": round(s["t1"] - s["t0"], 4), "transition_in": "cut",
              "transition_out": "cut", "reason": s["narration"]} for s in shots],
    "metadata": {"timeline_seconds": total, "reorder_notes": "Shot order follows narration beats."},
})

# Remotion props ride along on edit_decisions (video_compose passes them through).
render_props = dict(edit_decisions)
render_props.update({
    "scenes": scenes,
    "soundtrack": {"src": str(P / "assets" / "audio" / "narration.wav"), "volume": 1.0,
                   "fadeInSeconds": 0.05, "fadeOutSeconds": 0.8},
    "captions": {"words": caption_words, **cfg["captions"]},
})

out = P / "renders" / f"{NAME}.mp4"
if "--dry-run" in sys.argv:
    (P / "renders").mkdir(exist_ok=True)
    (P / "renders" / f"{NAME}.props.json").write_text(json.dumps(render_props, indent=1))
    print(f"artifacts valid; props written to renders/{NAME}.props.json (no render)")
else:
    result = VideoCompose().execute({
        "operation": "render",
        "edit_decisions": render_props,
        "asset_manifest": {"version": "1.0", "assets": [
            {**a, "path": str(P / a["path"])} for a in asset_manifest["assets"]]},
        "proposal_packet": {"production_plan": {"render_runtime": "remotion"}},
        "profile": "youtube_shorts",
        "output_path": str(out),
        "remotion_timeout_ms": 120000,
    })
    print("render", result.success, result.error or "")
    review = (result.data or {}).get("final_review") or {}
    print("final review:", review.get("recommended_action"), review.get("issues_found"))

if "--checkpoints" in sys.argv:
    root, pid = P.parent, P.name
    note = cfg.get("approval_note", "User approved concept, hook and scene map")
    write_checkpoint(root, pid, "idea", "completed", {"brief": brief}, human_approval_required=True,
                     human_approved=True, metadata={"approval_note": note})
    write_checkpoint(root, pid, "scene_plan", "completed", {"scene_plan": scene_plan, "script": script},
                     human_approval_required=True, human_approved=True,
                     metadata={"approval_note": note})
    write_checkpoint(root, pid, "assets", "completed", {"asset_manifest": asset_manifest},
                     human_approval_required=True, human_approved=True,
                     metadata={"approval_note": "User pre-authorised asset production through the draft render"})
    write_checkpoint(root, pid, "edit", "awaiting_human", {"edit_decisions": edit_decisions},
                     human_approval_required=True,
                     metadata={"draft_render": str(out), "note": "Awaiting user review of the draft"})
    print("checkpoints written")
