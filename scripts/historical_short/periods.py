#!/usr/bin/env python3
"""Historical period detection and period kits.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

A period kit (styles/periods/<id>.yaml) describes what soldiers, weapons,
buildings and landscapes looked like in an era, for:
  * the code-drawn battle illustrations (BattleSceneView: faction uniforms,
    headgear, weapons, artillery, architecture, palette), and
  * local AI illustration prompts (generate_illustration.py: positive period
    vocabulary + anachronism negatives).

The episode names its kit with ``period: <id>``; new_episode.py/plan_scenes.py
fill it in automatically from the year in the topic.

Usage:
    python scripts/historical_short/periods.py detect "The Battle of Waterloo (1815)"
    python scripts/historical_short/periods.py list
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
KITS = REPO / "styles" / "periods"

# (id, first year, last year) — negative years are BC. Order matters for overlaps.
RANGES = [
    ("ancient-mediterranean", -1200, 499),
    ("medieval", 500, 1449),
    ("early-modern", 1450, 1699),
    ("eighteenth-century", 1700, 1791),
    ("napoleonic", 1792, 1830),
    ("nineteenth-century", 1831, 1899),
    ("first-world-war", 1900, 1919),
    ("second-world-war", 1920, 1950),
]


def parse_year(text: str) -> int | None:
    """First plausible year in a topic: '216 BC' -> -216, 'AD 9' -> 9, '1815' -> 1815."""
    m = re.search(r"\b(\d{1,4})\s*(BC|BCE|B\.C\.)\b", text, re.I)
    if m:
        return -int(m.group(1))
    m = re.search(r"\b(?:AD|A\.D\.|CE)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:AD|CE)\b", text, re.I)
    if m:
        return int(m.group(1) or m.group(2))
    m = re.search(r"\b(1[0-9]{3}|[5-9][0-9]{2})\b", text)
    if m:
        return int(m.group(1))
    return None


def detect_period(topic: str, year: int | None = None) -> str | None:
    year = parse_year(topic) if year is None else year
    if year is None:
        return None
    for pid, a, b in RANGES:
        if a <= year <= b:
            return pid
    return None


def load_kit(period: str) -> dict:
    path = KITS / f"{period}.yaml"
    if not path.exists():
        raise SystemExit(f"no period kit {path} (available: {', '.join(available())})")
    kit = yaml.safe_load(path.read_text())
    kit.setdefault("id", period)
    return kit


def available() -> list[str]:
    return sorted(p.stem for p in KITS.glob("*.yaml"))


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "detect":
        topic = " ".join(sys.argv[2:])
        print(detect_period(topic) or "unknown", parse_year(topic))
        return 0
    if len(sys.argv) >= 2 and sys.argv[1] == "list":
        for pid in available():
            kit = load_kit(pid)
            print(f"{pid:22s} {kit.get('years', '')}  {kit.get('name', '')}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
