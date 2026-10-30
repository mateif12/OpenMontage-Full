# Historical Short template

Scripts for making a vertical archival-footage Short from a topic, using free local tools only. They cut clips straight from the archive's URLs with HTTP range requests, so whole reels are never downloaded. Read `skills/creative/historical-shorts.md` first: it covers the rules on rights, accuracy and sound, and the step-by-step workflow.

| Script | Does | Network |
|---|---|---|
| `archive.py search/records/sheets/windows` | NARA search (cleared records only), full records, reel contact sheets, review windows | Only probes, sampled frames and chosen windows |
| `build_narration.py` | Piper TTS per segment, timeline layout, −15 LUFS, Whisper word timings and a pronunciation check | Whisper model download, first run only |
| `build_clips.py` | 9:16 clips from the cached windows: crop, grade, source line, credits, provenance sidecars | None |
| `build_render.py` | Schema-validated artifacts, Remotion render, checkpoints (`--dry-run` to validate only) | None |
| `build_deliverables.py` | Final encode plus SRT, script, rights manifest, clip timeline, preview sheet | None |

`example-d-day/` holds the inputs that produced the D-Day Short: `short_config.json`, `windows.json`, `narration_segments.json` and `shot_list.json`.

One-time setup: `make setup` (or the README's manual steps). Then download a Piper voice into `~/.piper/models/` and check its model card licence before publishing; `en_US-ryan-high`, for example, is CC BY-NC-SA. Install `faster-whisper` for the captions step.
