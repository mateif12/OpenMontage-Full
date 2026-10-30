"""Finalize an approved render and write the delivery package (output/).

Re-encodes renders/<draft>.mp4 to output/<project>_final.mp4 (H.264 High,
yuv420p broadcast range, BT.709, 30 fps, AAC 48 kHz, faststart), checks it
decodes cleanly, then generates from the project artifacts and the clip
provenance sidecars:
  subtitles.srt               caption pages with Whisper-aligned timings
  narration_script.md         final script with section timings
  sources_and_rights.json     machine-readable source + rights manifest
  sources_and_rights.md       human-readable version
  clip_timeline.csv           every shot: timeline in/out, record, source in/out, URL
  preview_contact_sheet.jpg   one frame per shot

Usage: .venv/bin/python templates/historical-short/build_deliverables.py <project> [draft]
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

P = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
OUT = P / "output"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def load(name):
    return json.loads((P / "artifacts" / name).read_text())


def ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def finalize(draft: Path) -> Path:
    OUT.mkdir(exist_ok=True)
    final = OUT / f"{P.name}_final.mp4"
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(draft),
        "-vf", "scale=in_range=full:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "16",
        "-r", "30", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", str(final)], check=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(final), "-f", "null", "-"],
                   check=True)
    return final


def write_srt(words, replace, words_per_page=3):
    """Same paging rule as the burned-in captions (3 words, break on , or .)."""
    pages, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= words_per_page or w["pageBreakAfter"]:
            pages.append(cur)
            cur = []
    if cur:
        pages.append(cur)
    lines = []
    for i, page in enumerate(pages, 1):
        start = page[0]["startMs"] / 1000
        end = page[-1]["endMs"] / 1000
        text = " ".join(replace.get(w["word"], w["word"]) for w in page)
        lines += [str(i), f"{ts(start)} --> {ts(end)}", text, ""]
    (OUT / "subtitles.srt").write_text("\n".join(lines), encoding="utf-8")
    return len(pages)


def main(final_mp4: Path):
    OUT.mkdir(exist_ok=True)
    cfg = load("short_config.json")
    voice = cfg["voice"]
    shots = load("shot_list.json")["shots"]
    layout = load("narration_layout.json")
    words = load("caption_words.json")
    records = {}
    rows = []
    for s in shots:
        prov = json.loads((P / "assets" / "video" / f"{s['id']}.provenance.json").read_text())
        rid = prov["record_id"]
        rec = json.loads((P / "research" / f"nara_record_{prov['naid']}.json").read_text())
        records[rid] = {
            "record_id": rid,
            "naid": prov["naid"],
            "title": prov["title"],
            "catalog_url": prov["catalog_url"],
            "media_url": prov["media_url"],
            "series": [a.get("title") for a in rec.get("ancestors", [])
                       if a.get("levelOfDescription") in ("series", "recordGroup")],
            "production_dates": [d.get("logicalDate") for d in rec.get("productionDates", [])],
            "use_restriction": rec.get("useRestriction"),
            "access_restriction": rec.get("accessRestriction"),
            "sound_type": rec.get("soundType"),
            "attribution": prov["attribution"],
        }
        rows.append({
            "shot": s["id"], "scene": s["scene"],
            "timeline_in": f"{s['t0']:.3f}", "timeline_out": f"{s['t1']:.3f}",
            "record_id": rid, "naid": prov["naid"],
            "source_in": f"{prov['source_in_seconds']:.3f}",
            "source_out": f"{prov['source_out_seconds']:.3f}",
            "crop_focus_x": s["focus_x"], "rights_status": prov["rights_status"],
            "narration": s["narration"], "shows": s["shows"],
            "record_support": s["record_support"], "media_url": prov["media_url"],
        })

    with open(OUT / "clip_timeline.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    manifest = {
        "video": final_mp4.name,
        "footage": list(records.values()),
        "shots": rows,
        "narration": {
            "engine": "Piper TTS (local)",
            "voice": voice["name"],
            "voice_model_card": voice["model_card"],
            "open_question": voice.get("open_question", ""),
        },
        "music": cfg["music"],
        "sound_effects": cfg.get("sound_effects", "None added."),
        "stills": "None.",
    }
    (OUT / "sources_and_rights.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    md = [f"# Sources and rights — {cfg['title']}", "",
          cfg.get("intro", "") + " Rights were read from each record's own catalog description "
          "(not assumed from the archive's status).", "",
          "| Record | NAID | Title | Date (as catalogued) | Use restriction | Access | Sound |",
          "|---|---|---|---|---|---|---|"]
    for r in records.values():
        md.append(f"| [{r['record_id']}]({r['catalog_url']}) | {r['naid']} | {r['title']} | "
                  f"{', '.join(d or '' for d in r['production_dates'])} | "
                  f"{r['use_restriction'].get('status')} | {r['access_restriction'].get('status')} | "
                  f"{r['sound_type']} |")
    flagged = [r["record_id"] for r in records.values()
               if r["use_restriction"].get("note") or r["use_restriction"].get("specificUseRestrictions")]
    md += ["", ("Records with a use-restriction note or specific restriction: " + ", ".join(flagged))
           if flagged else "No record carries a use-restriction note or specific-use restriction.",
           "Dates are given exactly as catalogued; on-screen text claims no more precision than that.", "",
           "**Attribution used on screen:** \"" + " — ".join(cfg.get("overlays", {}).get("credits", []))
           + "\".", "",
           "## Narration voice", "",
           f"- {manifest['narration']['engine']}, voice `{manifest['narration']['voice']}`.",
           f"- Model card: {manifest['narration']['voice_model_card']}"]
    if manifest["narration"]["open_question"]:
        md.append(f"- Open question: {manifest['narration']['open_question']}")
    md += ["", "## Audio", "", f"- Music: {cfg['music'].get('source')} — {cfg['music'].get('note', '')}",
           f"- Sound effects: {manifest['sound_effects']}",
           "", "## Per-shot sources", "", "See `clip_timeline.csv` for every shot's archive in/out "
           "points, media URL, crop position and the shot-list entry that supports its narration."]
    (OUT / "sources_and_rights.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    script = [f"# Narration script — {cfg['title']}", "",
              f"Voice: Piper `{voice['name']}`, length scale {voice['length_scale']}. "
              "Timings are positions in the final video.", ""]
    for s in layout["segments"]:
        script.append(f"**{s['start']:.2f}–{s['end']:.2f}s** — {s['caption']}")
        if s["spoken"] != s["caption"]:
            script.append(f"  *(sent to TTS as: \"{s['spoken']}\" — respelled so the voice "
                          "pronounces it correctly; verified by Whisper transcription)*")
        script.append("")
    script += [f"Words: {sum(len(s['caption'].split()) for s in layout['segments'])}. "
               f"Narration ends at {layout['segments'][-1]['end']:.2f}s; video runs "
               f"{shots[-1]['t1']:.2f}s."]
    (OUT / "narration_script.md").write_text("\n".join(script) + "\n", encoding="utf-8")

    pages = write_srt(words, cfg.get("caption_display_replacements", {}))

    # One mid-shot frame per shot, from the final file.
    frames = []
    for s in shots:
        t = (s["t0"] + s["t1"]) / 2
        img = P / "renders" / f".sheet_{s['id']}.jpg"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i",
                        str(final_mp4), "-frames:v", "1", "-vf",
                        f"scale=240:426,drawtext=fontfile={FONT}:text='{s['id']} {t:.1f}s':"
                        "fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.7:x=4:y=4",
                        str(img)], check=True)
        frames.append(img)
    args = [a for f in frames for a in ("-i", str(f))]
    grid = "".join(f"[{i}:v]" for i in range(len(frames)))
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args, "-filter_complex",
                    f"{grid}xstack=inputs={len(frames)}:grid=9x2",
                    str(OUT / "preview_contact_sheet.jpg")], check=True)
    for f in frames:
        f.unlink()
    print(f"wrote {OUT}: {pages} subtitle cues, {len(rows)} shots, {len(records)} records")


if __name__ == "__main__":
    draft = P / "renders" / f"{sys.argv[2] if len(sys.argv) > 2 else 'draft'}.mp4"
    main(finalize(draft))
