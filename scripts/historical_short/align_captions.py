#!/usr/bin/env python3
"""Time the user's exact narration script to the narration audio.

Part of the historical-short workflow
(skills/pipelines/documentary-montage/historical-short.md).

The caption TEXT always comes from the approved script (never from the
speech recogniser). Whisper only supplies timings: script words are matched
to recognised words with a sequence alignment; any script word Whisper
missed or misheard gets a time interpolated from its aligned neighbours.

Input:  script .txt (one sentence per line is fine) + transcriber output JSON
        (tools/analysis/transcriber.py, word_timestamps=True).
Output: captions.json  -> {"words": [{word, startMs, endMs, pageBreakAfter}],
                           "sentences": [{text, startMs, endMs}], "report": {...}}
        captions.srt   -> sentence-level SRT (for YouTube upload)

Usage:
    python scripts/historical_short/align_captions.py \
        --script  projects/<ep>/artifacts/script.txt \
        --transcript projects/<ep>/artifacts/transcript_raw.json \
        --out projects/<ep>/artifacts/captions.json
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

SENTENCE_END = re.compile(r"[.!?]['\"”’)]*$")
CLAUSE_END = re.compile(r"[,;:—]['\"”’)]*$")


def norm(token: str) -> str:
    return re.sub(r"[^0-9a-z]", "", token.lower().replace("’", "'"))


def script_words(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def align(script: list[str], heard: list[dict]) -> tuple[list[dict], dict]:
    a = [norm(w) for w in script]
    b = [norm(w["word"]) for w in heard]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    times: list[tuple[float, float] | None] = [None] * len(script)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            h = heard[blk.b + k]
            times[blk.a + k] = (h["start"], h["end"])
    # Replace-type opcodes of equal length (e.g. "Cannae" heard as "Canny"):
    # take the recogniser's timing position-for-position.
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "replace" and (i2 - i1) == (j2 - j1):
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["start"], heard[j1 + k]["end"])
    matched = sum(1 for t in times if t is not None)
    interpolated = []
    # Interpolate gaps between known anchors.
    i = 0
    n = len(script)
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        start = times[i - 1][1] if i > 0 else 0.0
        end = times[j][0] if j < n else (times[i - 1][1] + 0.4 * (j - i) if i > 0 else 0.4 * (j - i))
        step = max(0.05, (end - start) / (j - i))
        for k in range(i, j):
            times[k] = (start + step * (k - i), start + step * (k - i + 1))
            interpolated.append(script[k])
        i = j
    words = []
    for idx, (w, t) in enumerate(zip(script, times)):
        words.append({
            "word": w,
            "startMs": int(round(t[0] * 1000)),
            "endMs": int(round(t[1] * 1000)),
            "pageBreakAfter": bool(SENTENCE_END.search(w)),
        })
    report = {
        "script_words": n,
        "recognised_words": len(heard),
        "aligned_words": matched,
        "interpolated_words": interpolated,
        "similarity": round(sm.ratio(), 4),
    }
    return words, report


def sentences(words: list[dict]) -> list[dict]:
    out, cur = [], []
    for w in words:
        cur.append(w)
        if w["pageBreakAfter"]:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"text": " ".join(x["word"] for x in s), "startMs": s[0]["startMs"], "endMs": s[-1]["endMs"]} for s in out]


def srt_time(ms: int) -> str:
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script", required=True)
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-similarity", type=float, default=0.9,
                    help="fail if the audio does not match the script this closely")
    args = ap.parse_args()

    text = Path(args.script).read_text(encoding="utf-8")
    heard = json.loads(Path(args.transcript).read_text())["word_timestamps"]
    words, report = align(script_words(text), heard)
    sents = sentences(words)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"words": words, "sentences": sents, "report": report}, indent=1, ensure_ascii=False))
    srt = "\n".join(f"{i}\n{srt_time(s['startMs'])} --> {srt_time(s['endMs'])}\n{s['text']}\n"
                    for i, s in enumerate(sents, 1))
    out.with_suffix(".srt").write_text(srt, encoding="utf-8")
    print(json.dumps(report, indent=1))
    if report["similarity"] < args.min_similarity:
        print(f"ERROR: script/audio similarity {report['similarity']} < {args.min_similarity}. "
              "The MP3 does not match the approved script — stop and ask the user.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
