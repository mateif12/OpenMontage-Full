# Production report — D-Day: The Crossing

## Deliverable

| | |
|---|---|
| File | `d-day-short_final.mp4` |
| Format | H.264 High (yuv420p, broadcast range, BT.709), 1080 × 1920 (9:16), 30 fps |
| Audio | AAC-LC 48 kHz stereo, narration only; −15.9 LUFS integrated, −1.3 dBFS true peak |
| Duration | 47.85 s (narration 0.15–45.16 s; archive credit 45.5–47.8 s) |
| Shots | 18 hard cuts from 6 NARA reels, no repeated shots, no stills |
| Subtitles | Burned in (3 words per page, 88 px, 430 px above the bottom edge), plus `subtitles.srt` |

## Pipeline and tools

- **Pipeline:** `documentary-montage`. Runtime: Remotion (`CinematicRenderer`), profile `youtube_shorts`. All tools are free and local; no API keys or paid services.
- **Footage:** `remote_clip` (new) cut clips from the NARA media URLs with HTTP range requests. The NARA adapter now reads each record's own rights fields.
- **Narration:** Piper TTS 1.8.0, voice `en_US-joe-medium`, length scale 1.08.
- **Captions and checks:** faster-whisper `small.en` gave word timings and was used for the pronunciation and transcript checks.
- **Render:** Remotion used the local Chromium headless shell (`REMOTION_BROWSER_EXECUTABLE`), because `remotion.media` is not reachable from this environment.

## Network use (footage)

| Step | Read |
|---|---|
| Reel previews: 236 sampled frames across the six reels | ≈ 104 MB |
| Review windows: 11 windows, 368 s of source | 106.7 MB |
| Final cuts | 0 MB (cut locally from the cached windows) |
| **Total** | **≈ 210 MB of the 974 MB collection; no reel was downloaded in full** |

## Rights

All six records (428-NPC-10742, -10744, -10769, -10770, -10782, -10785) were re-read in full before use:
- Use restriction "Unrestricted" and access "Unrestricted".
- No notes and no specific-use restrictions.
- All catalogued as silent.

See `sources_and_rights.md`. NARA's "Unrestricted" status is the archive's own determination. It is the strongest documentation available, but it is not legal advice for every country. Third parties sometimes file Content ID claims on public archive footage.

## Historical accuracy controls

- **Claims kept general and sourced:** the narration claims "the largest seaborne invasion in history" and "thousands of ships and landing craft". It gives no exact casualty figure, uses only "thousands of men would never come home", and contains no quotations or times.
- **No shot is labelled with a date or beach.** The reels are dated June 1944 (or 1944) and name no beach. The on-screen source line reads "U.S. Coast Guard film | Normandy, June 1944".
- **Every shot is tied to its record.** Each one is paired with the record shot-list line that supports its narration (`clip_timeline.csv`, column `record_support`).
- **The battleship is not named.** The record mentions USS Texas, but which frames show it was not verified.
- **Graphic footage excluded:** 428-NPC-10782 shot-list items 37–38 (blood and remains). The wounded are shown only covered by blankets.

## QC performed

- **Shot boundaries:** every cut was checked against scene detection and 1 fps sheets, so no frames leak in from neighbouring shots.
- **Frame alignment:** all 18 cuts sit on whole frames. One-frame black flashes in the first draft were found with `blackdetect` and fixed.
- **Framing:** each 9:16 crop position was chosen per shot. The wounded man's face was re-framed so it stays in shot.
- **Repetition:** one near-duplicate shot was replaced (the beached landing craft appeared in both the hook and scene 4).
- **Brightness:** dark reels were lifted to compensate for the renderer's vignette and tone gradient.
- **Subtitles:** sized and positioned clear of the Shorts UI.
- **Pronunciation:** Piper read "wounded" as "winded" and was misheard on a sentence-initial "Ships". These were fixed with the TTS respelling "wooonded" and the line "More ships poured…", and verified with Whisper.
- **Final file:** transcribed 107 of 107 words against the script (the only difference is number formatting, "sixth" vs "6"). It decodes cleanly and matches the specifications above.

## Open items

1. **Voice licence:** `en_US-joe-medium` lists its dataset as CC0, but it was fine-tuned from the `lessac` voice. The lessac dataset licence page (cstr.ed.ac.uk) is blocked here, so I could not verify it. If you want no ambiguity, `en_US-norman-medium` (trained from scratch on public-domain LibriVox audio) is already downloaded and needs only a re-voice and re-render.
2. **Music:** none was used, as instructed.
