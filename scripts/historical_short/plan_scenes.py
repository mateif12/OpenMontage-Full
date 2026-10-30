#!/usr/bin/env python3
"""Write a scene-plan skeleton for a historical Short from the narration timing.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md). Called by
new_episode.py; can be re-run with --force.

What it does (so the agent only has to choose and refine visuals):
  * one beat per sentence, cut in the middle of the pause before it; very
    short sentences are merged, long ones split at their longest word gap;
    first scene starts at 0, last ends at the master duration
  * detects the period from the topic (periods.py) -> `period:`
  * tags each beat: combat / place / person / aftermath, and suggests the
    visual type the rules want (combat -> painting detail or battle
    illustration; place -> short map; person -> portrait)
  * matches the period's curated asset pack (library/packs/<period>.yaml) by
    subject words and proposes the asset + its default label
  * writes a fact_check stub per sentence

Output: projects/<id>/episode.yaml (gitignored). Every scene needs review —
placeholders (`kind: TODO`) make build_props.py fail until they are filled.

Usage:
    python scripts/historical_short/plan_scenes.py --project projects/<id> [--topic "..."] [--force]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import periods  # noqa: E402
from episode_rules import COMBAT_WORDS  # noqa: E402

MIN_BEAT = 1.8   # s — shorter sentences merge into the next beat
MAX_BEAT = 6.5   # s — longer sentences split at their longest pause

AFTERMATH_WORDS = re.compile(r"\b(ended|end of|aftermath|dead|killed|surrender\w*|exile\w*|abdicat\w*|forever)\b", re.I)
PLACE_HINT = re.compile(r"\b(near|at|in|from|towards?|across|marched|approach\w*|east|west|north|south|village|city|river|coast)\b", re.I)


def load_pack(period: str | None) -> list[dict]:
    if not period:
        return []
    p = HERE / "library" / "packs" / f"{period}.yaml"
    return (yaml.safe_load(p.read_text()) or {}).get("assets", []) if p.exists() else []


def norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower())


def pack_matches(text: str, pack: list[dict], tags: list[str]) -> list[dict]:
    words = set(norm(text).split())
    scored = []
    for a in pack:
        subj = set()
        for s in a.get("subjects", []):
            subj |= set(norm(s.replace("-", " ")).split())
        hits = {w for w in words for t in subj
                if w == t or (min(len(w), len(t)) >= 5 and (w.startswith(t) or t.startswith(w)))}
        score = len(hits) * 2
        if "combat" in tags and a.get("kind") == "battle-painting":
            score += 1
        if "aftermath" in tags and a.get("kind") == "aftermath-painting":
            score += 2
        if "person" in tags and a.get("kind") == "portrait":
            score += 1
        if score >= 2:
            scored.append((score, a))
    scored.sort(key=lambda x: -x[0])
    return [a for _, a in scored[:3]]


def beats_from_captions(captions: dict, duration: float) -> list[dict]:
    words = captions["words"]
    sents = captions["sentences"]
    beats = []
    for s in sents:
        t0, t1 = s["startMs"] / 1000, s["endMs"] / 1000
        ws = [w for w in words if t0 - 0.01 <= w["startMs"] / 1000 <= t1]
        beats.append({"t0": t0, "t1": t1, "text": s["text"], "words": ws})
    # merge very short sentences into the following one
    merged: list[dict] = []
    carry = None
    for b in beats:
        if carry:
            b = {"t0": carry["t0"], "t1": b["t1"], "text": carry["text"] + " " + b["text"],
                 "words": carry["words"] + b["words"]}
            carry = None
        if b["t1"] - b["t0"] < MIN_BEAT and b is not beats[-1]:
            carry = b
            continue
        merged.append(b)
    if carry:
        merged.append(carry)
    # split long beats at the longest internal word gap
    out: list[dict] = []
    for b in merged:
        ws = b["words"]
        if b["t1"] - b["t0"] > MAX_BEAT and len(ws) > 6:
            gaps = [(ws[i + 1]["startMs"] - ws[i]["endMs"], i) for i in range(2, len(ws) - 3)]
            _, i = max(gaps) if gaps else (0, len(ws) // 2)
            cut = ws[i]["endMs"] / 1000
            first = " ".join(w["word"] for w in ws[: i + 1])
            second = " ".join(w["word"] for w in ws[i + 1:])
            out.append({"t0": b["t0"], "t1": cut, "text": first, "words": ws[: i + 1], "split": True})
            out.append({"t0": ws[i + 1]["startMs"] / 1000, "t1": b["t1"], "text": second, "words": ws[i + 1:],
                        "split": True})
        else:
            out.append(b)
    # cut points in the pauses
    for i, b in enumerate(out):
        b["start"] = 0.0 if i == 0 else round((out[i - 1]["t1"] + b["t0"]) / 2, 2)
    for i, b in enumerate(out):
        b["end"] = round(duration, 3) if i == len(out) - 1 else out[i + 1]["start"]
    return out


def tag_beat(text: str) -> list[str]:
    tags = []
    if COMBAT_WORDS.search(text):
        tags.append("combat")
    if AFTERMATH_WORDS.search(text):
        tags.append("aftermath")
    if re.search(r"\b(?:[A-Z][a-zé]+ ){0,2}(?:Napoleon|Duke|King|Emperor|General|Marshal|Field Marshal|"
                 r"Queen|Pope|Sultan|Caesar|Hannibal|Admiral|President)\b", text) or \
            re.search(r"\b(led by|commanded by)\b", text):
        tags.append("person")
    if PLACE_HINT.search(text) and re.search(r"\b[A-Z][a-z]+", text[1:]):
        tags.append("place")
    return tags


def suggestion(tags: list[str]) -> str:
    if "combat" in tags:
        return ("COMBAT beat: battle painting with a camera/detail path or parallax layers + fx smoke/flashes, "
                "or a `battle` illustration (code-drawn kit) / reviewed AI illustration. NOT a map.")
    if "aftermath" in tags:
        return "aftermath/consequence: aftermath painting, site photo or `battle` template aftermath"
    if "person" in tags:
        return "person: period portrait (detail push-in on the face) or event painting showing them"
    if "place" in tags:
        return "place/movement: short map (<= 7 s, never two in a row) or site photo"
    return "establishing/transition: painting detail, site photo or illustration"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--topic")
    ap.add_argument("--period")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    project = Path(a.project)
    out = project / "episode.yaml"
    if out.exists() and not a.force:
        print(f"{out} exists (use --force to overwrite)")
        return 0
    brief = json.loads((project / "artifacts" / "episode_brief.json").read_text())
    captions = json.loads((project / "artifacts" / "captions.json").read_text())
    topic = a.topic or brief.get("topic", "")
    duration = float(brief.get("duration_seconds") or 0)
    if not duration:
        import subprocess
        duration = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                         "csv=p=0", str(project / "assets/audio/narration_master.wav")],
                                        capture_output=True, text=True, check=True).stdout)
    period = a.period or periods.detect_period(topic)
    pack = load_pack(period)
    beats = beats_from_captions(captions, duration)

    scenes = []
    for i, b in enumerate(beats):
        tags = tag_beat(b["text"])
        sc = {"id": f"s{i + 1:02d}", "kind": "TODO", "start": b["start"], "end": b["end"],
              "sentence": b["text"], "tags": tags, "suggest": suggestion(tags)}
        matches = pack_matches(b["text"], pack, tags)
        if matches:
            sc["pack_candidates"] = [
                {"id": m["id"], "kind": m.get("kind"), "reviewed": m.get("reviewed", False),
                 "label": m.get("label")} for m in matches]
        scenes.append(sc)

    ep = {
        "id": project.name,
        "title": topic,
        "rules_version": 2,
        "period": period or "TODO",
        "narration": "audio/narration_master.wav",
        "ambience": {"src": "audio/ambience.wav", "volume": 0.08},
        "images_dir": "images",
        "caption_style": {"fontSize": 60, "wordsPerPage": 5, "bottomOffset": 470},
        "decisions": {"render_runtime": "remotion", "music": "none", "end_tag": "none",
                      "generated_media": "none (set to 'local-ai: <model>' if AI illustrations are used)"},
        "fact_check": [{"claim": s["text"], "support": "TODO"} for s in captions["sentences"]],
        "scenes": scenes,
    }
    header = (f"# Scene-plan skeleton written by plan_scenes.py for: {topic}\n"
              "# Fill every `kind: TODO` (see `suggest`), pick assets from `pack_candidates` or new\n"
              "# Commons files, then: build_props.py -> render.py --preview -> render.py.\n"
              "# `sentence`, `tags`, `suggest`, `pack_candidates` are notes; build_props ignores them.\n")
    out.write_text(header + yaml.safe_dump(ep, sort_keys=False, allow_unicode=True, width=110))
    combat = sum("combat" in s["tags"] for s in scenes)
    print(f"wrote {out}: {len(scenes)} beats ({combat} combat), period={period}, "
          f"{sum(1 for s in scenes if s.get('pack_candidates'))} beats with pack candidates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
