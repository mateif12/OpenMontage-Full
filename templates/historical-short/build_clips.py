"""Cut the final vertical clips of a historical Short from its cached archive windows.

Reads artifacts/shot_list.json; each shot names a window extracted earlier
(assets/windows/*.mp4, with a provenance sidecar), the archive time to cut
from, its timeline slot (t0/t1, whole frames at 30 fps), crop position and
grade. Cuts are taken locally from the windows via the `remote_clip` tool,
so this step reads nothing from the network. Overlay text comes from
artifacts/short_config.json ("overlays").

Usage: .venv/bin/python templates/historical-short/build_clips.py <project> [shot_id ...]
"""
import concurrent.futures as cf
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.video.remote_clip import RemoteClip  # noqa: E402

P = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
O = P / "assets" / "overlays"

def label_filter(kind: str, duration: float, shot: dict) -> str:
    """drawtext overlays; times are relative to the shot."""
    if kind == "source_line":
        # Small source line on the opening shot; fades with the shot.
        out = duration - 0.34
        return (
            f"drawtext=fontfile={BOLD}:textfile={O}/source_line.txt:fontsize=34:"
            "fontcolor=white@0.92:shadowcolor=black@0.8:shadowx=2:shadowy=2:x=(w-tw)/2:y=210:"
            f"alpha='if(lt(t,0.25),t/0.25,if(gt(t,{out:.3f}),max(0,({duration:.3f}-t)/0.34),1))'"
        )
    if kind == "credits":
        # Archive credit on the last shot, after the narration ends
        # ("credits_from" = timeline seconds; default 2.2 s before the end).
        at = shot.get("credits_from", shot["t1"] - 2.2) - shot["t0"]
        return ",".join(
            f"drawtext=fontfile={font}:textfile={O}/{name}.txt:fontsize={size}:fontcolor=white@0.95:"
            f"shadowcolor=black@0.85:shadowx=2:shadowy=2:x=(w-tw)/2:y={y}:"
            f"alpha='if(lt(t,{at:.3f}),0,min(1,(t-{at:.3f})/0.4))'"
            for name, font, size, y in [
                ("credit1", BOLD, 40, 1218),
                ("credit2", REG, 36, 1285),
                ("credit3", REG, 34, 1338),
            ]
        )
    raise ValueError(f"unknown label {kind!r}")


PROVENANCE_KEYS = (
    "source", "record_id", "naid", "catalog_url", "title", "creator", "rights_status",
    "rights_note", "access_status", "rights_cleared", "sound_type", "attribution", "media_url",
)


def write_overlays() -> None:
    cfg = json.loads((P / "artifacts" / "short_config.json").read_text())
    O.mkdir(parents=True, exist_ok=True)
    overlays = cfg.get("overlays", {})
    (O / "source_line.txt").write_text(overlays.get("source_line", ""))
    for i, line in enumerate(overlays.get("credits", [])[:3], 1):
        (O / f"credit{i}.txt").write_text(line)


def cut(shot: dict, grades: dict) -> tuple:
    window = P / "assets" / "windows" / shot["window"]
    wprov = json.loads(window.with_suffix(".provenance.json").read_text())
    offset = wprov["source_in_seconds"]
    prov = {k: wprov[k] for k in PROVENANCE_KEYS}
    prov.update({
        "window_offset_seconds": offset,
        "shot_id": shot["id"],
        "shows": shot["shows"],
        "record_support": shot["record_support"],
    })
    duration = shot["t1"] - shot["t0"]
    vf = grades[shot["grade"]]
    if shot.get("label"):
        vf += "," + label_filter(shot["label"], duration, shot)
    start = round(shot["src_in"] - offset, 3)
    result = RemoteClip().execute({
        "operation": "extract",
        "url": str(window),
        "start_seconds": start,
        "end_seconds": round(start + duration, 3),
        "target": {"width": 1080, "height": 1920, "fps": 30},
        "focus_x": shot["focus_x"],
        "active_area": "auto",
        "video_filter": vf,
        "crf": 16,
        "provenance": prov,
        "use_cache": False,
        "output_path": str(P / "assets" / "video" / f"{shot['id']}.mp4"),
    })
    return shot["id"], result.success, result.error


def main(only: list[str]) -> None:
    write_overlays()
    plan = json.loads((P / "artifacts" / "shot_list.json").read_text())
    shots = [s for s in plan["shots"] if not only or s["id"] in only]
    with cf.ThreadPoolExecutor(4) as ex:
        for sid, ok, err in ex.map(lambda s: cut(s, plan["grades"]), shots):
            print(sid, "ok" if ok else f"FAILED: {err}")


if __name__ == "__main__":
    main(sys.argv[2:])
