# Historical Shorts from Archival Footage

Use this Layer 2 skill when a user wants a vertical Short (YouTube Shorts, Reels, TikTok) about a historical topic built **only from authentic archival moving footage**, with free local narration. It runs on the `documentary-montage` pipeline and drives the scripts in `templates/historical-short/`. Worked example: `templates/historical-short/example-d-day/` (the D-Day Short, 47.8 s, six NARA reels).

## Non-negotiables

- **Real footage only.** No AI-generated visuals, reenactments, movie footage or stills unless the user approves stills explicitly.
- **Rights come from the record, not the archive.** A government archive hosting a file does not make it public domain. Use a record only when its own catalog fields document the use: for NARA, `useRestriction.status == "Unrestricted"` and `accessRestriction.status == "Unrestricted"`. "Restricted - Possibly" (copyright), "Undetermined", or any note or specific restriction means exclude, or ask the user.
- **Claim no more than the record does.** If a reel is dated `1944-06-01`, that is a month, not 6 June. Do not label a shot with a day, a beach, a ship or a person unless the record ties that identification to that shot. Narration can state well-sourced history. On-screen labels describe the film ("U.S. Coast Guard film | Normandy, June 1944").
- **Verify that the file matches the record.** Some catalog records link a file named for a different record. `archive.py search` flags these; treat them as unverified footage.
- **No invented sound.** Most WWII reels are catalogued `soundType: Silent`. Do not add battle sound effects and present them as historical. Add music only with a licence documented for the intended use.
- **No graphic footage.** Read the shot list for injuries and casualties. Pick windows that end before any graphic shot.

## Why the workflow is cheap on bandwidth

NARA media URLs (`catalog.archives.gov/medialz/...`) answer HTTP range requests and keep the MP4 index at the front, so FFmpeg seeks inside the remote file. Measured on the D-Day reels (103–197 MB each):

| Step | Network read |
|---|---|
| Probe one reel | 0.14–0.98 MB |
| Contact sheet, one frame every 15 s (six reels, 236 frames) | ~104 MB (frames are ~0.36–0.55 MB each) |
| Review windows (11 windows, ~6 min of source) | 106.7 MB |
| Final cuts (18 shots) | 0 MB, cut locally from the cached windows |

Total ≈ 210 MB against 974 MB for the full reels. The shared clip cache (`~/.openmontage/clips_cache`, LRU, 20 GB default) holds every extracted window. Re-extracting the same window in a later project is a local hard link. In an ephemeral cloud container the cache lasts only for the session.

## Steps

Run everything from the repository root with `.venv/bin/python`. `P=projects/<project-id>`.

1. **Initialise.** Run `from lib.checkpoint import init_project; init_project('<id>', title=..., pipeline_type='documentary-montage')`. Copy `example-d-day/short_config.json` into `$P/artifacts/` and edit the title, hook, scenes, voice, overlays and credits.
2. **Research the history.** Verify every factual claim in the script against more than one reputable source. Do not invent exact times, casualty figures, quotations or eyewitness statements. Prefer "thousands" over a number you cannot source.
3. **Find footage.** Run `archive.py search $P "<query>" ...`. It keeps only cleared records that have an MP4. Run `archive.py records $P <naid>...` and read each record's full shot list and rights fields. Run `archive.py sheets $P <naid>... --step 15` and look at the sheets (`$P/research/sheet_<naid>.jpg`).
4. **Pull review windows.** Write `$P/artifacts/windows.json` with only the stretches you need, padded a few seconds on each side. Run `archive.py windows $P`. Inspect `$P/research/window_sheets/*.jpg` (1 fps, labelled with reel time). Use `ffmpeg -vf scdet` on a window to find exact shot boundaries. Faded 16 mm film defeats scene detection, so confirm cuts on the sheets.
5. **Write and voice the script.** Put the narration in `$P/artifacts/narration_segments.json`: one segment per sentence or beat, aiming for about 105–125 words for 45–55 s. Run `build_narration.py $P`. It reports every word Whisper hears differently from the script. Anything beyond number formatting is a mispronunciation: respell it in `"spoken"` (e.g. Piper joe says "wounded" as "winded"; `"wooonded"` fixes it) and run again. Captions always show the `"caption"` text.
6. **Plan shots.** Write `$P/artifacts/shot_list.json` (see the example). Each shot has:
   - `t0`/`t1` on whole frames at 30 fps, with cuts in the pauses between narration phrases;
   - `window` and the archive `src_in`;
   - `focus_x`, the horizontal crop position (test it on stills first);
   - a `grade` key;
   - `narration`, `shows` and `record_support`, which quotes the shot-list line that justifies the pairing.

   Mark the first shot `"label": "source_line"` and the last `"label": "credits"` (`credits_from` = timeline second after the narration ends).
7. **Cut clips.** Run `build_clips.py $P` (local, no network). QC frames from the start, middle and end of each clip: crop, faces, no stray frames from neighbouring shots, no repeated angles.
8. **Render the draft.** Set `REMOTION_BROWSER_EXECUTABLE` if Remotion cannot download its headless shell. Run `build_render.py $P draft --checkpoints`. Check `blackdetect` for one-frame flashes (they come from off-frame boundaries) and look at a frame grid. Transcribe the rendered audio and compare it with the script.
9. **Present the draft** to the user (edit gate). After approval, run `build_deliverables.py $P draft`. It re-encodes to `output/<id>_final.mp4` (H.264 High, yuv420p broadcast range, BT.709, 30 fps, AAC 48 kHz, faststart) and writes `subtitles.srt`, `narration_script.md`, `sources_and_rights.{json,md}`, `clip_timeline.csv` and `preview_contact_sheet.jpg`.

## Craft notes

- **Hook (first 2–3 s):** an immediate, true, high-stakes line over the strongest readable wide shot. Avoid dark silhouettes: they read as black on a phone.
- **Vertical framing of 4:3 film:** the 9:16 crop keeps about 41% of the picture width. Choose `focus_x` per shot, and test faces and key action on stills first.
- **Captions:** 3 words per page, about 88 px, bottom offset about 430 px so the Shorts UI (bottom ~300 px, right-hand buttons) does not cover them.
- **Remotion's CinematicRenderer** adds a tone gradient and vignette. Lift dark reels with the per-grade CSS `brightness()` in `css_grades`.
- **Loudness:** narration-only mix at about −15 LUFS integrated, limiter ceiling about −1.5 dBTP.

## Tools

- `remote_clip`: probe, contact sheet and extract from URLs or cached windows, with provenance sidecars and rights gating.
- `stock_sources/nara.py`: catalog search that reports each record's own rights fields and excludes uncleared records by default.
- `piper_tts`, `transcriber` (faster-whisper), `video_compose` (Remotion, `youtube_shorts` profile).
