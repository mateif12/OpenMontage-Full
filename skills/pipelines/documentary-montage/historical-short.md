# Historical Short Profile - Documentary Montage Pipeline

A reusable, mostly automated profile of the `documentary-montage` pipeline for
**narrated vertical YouTube Shorts about history**. The user gives you **an MP3
narration and a topic**; you deliver **a finished 1080x1920 MP4**. Everything
needed is in this repository — do not rely on any earlier conversation.

First episode built with it: *The Battle of Cannae (216 BC)*, 2026-10-30
(`scripts/historical_short/episodes/battle-of-cannae.yaml` — use it as the
worked example).

## The User's Standing Instructions (binding for every episode)

- **Inputs:** one MP3 (attached to the session) + one topic. A script is
  optional; the **spoken narration is the source of truth** for captions.
- **Work autonomously.** The user is not a programmer: never ask them to run
  commands or move files. Make ordinary technical decisions yourself. Show a
  short production summary and the asset/licence table with the delivery.
  Only stop for a genuine blocker (explain it simply + propose a workaround).
  This is a recorded full-run pre-authorisation for the pipeline's gated
  stages — log it as `decision_log` `category: "approval_policy"`.
- **Never commit, push, merge or publish** without the user's explicit
  permission in the current session. Leave changes uncommitted and list them.
- **Free tools only.** No paid APIs, credit-consuming generators or
  subscriptions.
- **Deliver** `projects/<id>/renders/final.mp4` with `SendUserFile`
  (`display: "attach"`), plus the credits text for the YouTube description.

### Visual rules

| Rule | How the workflow enforces it |
|------|------------------------------|
| Cinematic documentary, not a slideshow | maps fly, diagrams animate on narrated beats, stills get slow camera moves, dissolves, vignette, consistent palette |
| Hierarchy: authentic material first | `fetch_commons.py` (Wikimedia Commons: museum objects, sites, artworks, documents) |
| Original visuals where no authentic material exists | `map`, `tactics`, `illustration` scenes in the HistoricalShort composition |
| Never misrepresent | every scene carries a label: `SITE PHOTO`, `MUSEUM ARTIFACT`, `PAINTING, <year> · ARTISTIC INTERPRETATION`, `ORIGINAL MAP`, `ORIGINAL DIAGRAM`, `ORIGINAL ILLUSTRATION` |
| No invented specifics | illustrations use generic silhouettes (round shield + spear); diagrams say "schematic · not to scale"; disputed identifications say "traditionally identified as" |
| No AI images/video/voice, no reenactments, film clips or unrelated stock | image/video/TTS selectors are never called; no Pexels/Pixabay footage |
| Commercial-use licences verified | licence gate (PD, CC0, CC BY, CC BY-SA only) + provenance JSON per file + `CREDITS.txt` |
| Every scene supports the narration | scenes are cut in the pauses between narrated sentences and chosen per sentence |

### Technical defaults

9:16 · 1080x1920 · 30 fps · H.264 MP4 · narration normalised to -16 LUFS /
-1.5 dBTP (two-pass EBU R128) with a 0.5 s lead-in and 1.2 s tail for the
opening/closing fades · captions word-by-word from the narration, large
Space Grotesk on a dark plate, kept above the Shorts UI · no music; optional
very quiet original ambience (synthesised locally) · no logos/watermarks.

### Approved deviations from documentary-montage defaults

Narration ON (user MP3); music none (ambience optional, ~27 dB under voice);
end tag opted out; stills + original animation instead of stock clips; render
via `video_compose` with `render_runtime: "remotion"` and its custom-composition
route (`composition_mode: "atelier"`, entry
`remotion-composer/src/historical-short/entry.tsx`). HyperFrames is not
supported on documentary-montage, so Remotion is the runtime.

## Files

| Path (tracked) | Role |
|---|---|
| `HISTORICAL_SHORTS.md` | one-page quick start for a new session |
| `skills/pipelines/documentary-montage/historical-short.md` | this guide |
| `styles/historical-documentary.yaml` | style playbook |
| `scripts/historical_short/new_episode.py` | **entry point**: project, audio master, transcription, captions, ambience, brief |
| `scripts/historical_short/fetch_commons.py` | Commons search / info / fetch with licence gate + provenance |
| `scripts/historical_short/align_captions.py` | word captions + SRT (text from script or transcript, timings from Whisper) |
| `scripts/historical_short/build_basemap.py` | Natural Earth coastlines → SVG path JSON |
| `scripts/historical_short/make_ambience.py` | optional original wind/room-tone bed |
| `scripts/historical_short/build_props.py` | episode.yaml → Remotion props + `CREDITS.txt` (validates timing, labels, licences) |
| `scripts/historical_short/render.py` | render via `video_compose`, then QC + contact sheet |
| `scripts/historical_short/episode.template.yaml` | template for a new episode |
| `scripts/historical_short/episodes/<id>.yaml` | per-episode timeline, labels, fact-check |
| `remotion-composer/src/historical-short/` | `HistoricalShort` composition: `image`, `map`, `tactics`, `illustration` scenes, labels, captions |
| `remotion-composer/remotion.config.ts` | uses a local Chromium when `REMOTION_BROWSER_EXECUTABLE` is set |

Generated (gitignored): `projects/<id>/` — audio, images, maps, artifacts, renders.

## Environment Setup (fresh cloud container — do it yourself, silently)

```bash
pip install -r requirements.txt
pip install faster-whisper pyshp "av>=14,<16"   # faster-whisper 1.2.x breaks on PyAV >= 16
cd remotion-composer && npm install && cd ..
```

- Whisper models download from Hugging Face; `new_episode.py` sets
  `HF_HUB_DISABLE_XET=1` (the Xet CDN is often blocked).
- Network hosts used: `commons.wikimedia.org`, `upload.wikimedia.org`,
  `en.wikipedia.org`, `huggingface.co`, `naturalearth.s3.amazonaws.com`.
  If one is denied by the environment's network policy, tell the user which
  host and that they can add it under the environment's Network access
  settings; continue with everything else.
- Wikimedia rate-limits shared cloud IPs (HTTP 429). `fetch_commons.py`
  backs off automatically and requests standard thumbnail widths (originals
  are throttled hardest; `thumb.wikimedia.org` URLs are rewritten to
  `upload.wikimedia.org`). Run downloads **in the background, most important
  first**, ≥ 10 s apart, and build the other scenes meanwhile. If an image
  never arrives, replace the scene with an original map / diagram /
  illustration rather than block delivery.
- Remotion uses the preinstalled Chromium (`render.py` sets
  `REMOTION_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium`).

## Process

### 1. Set up the episode (≈ 1 min)

Find the attached MP3 (session uploads, e.g. `/root/.claude/uploads/...`), then:

```bash
python scripts/historical_short/new_episode.py --mp3 <path.mp3> --topic "<Topic>" --id <kebab-id>
```

It prints the sentence list with times (on the padded master clock) and writes
`projects/<id>/artifacts/episode_brief.json`, `transcript.txt`,
`captions.json`, `captions.srt`. Read the transcript. If the recogniser
misspelled a proper noun and you are certain of the correct spelling, write
the corrected text to `artifacts/script.txt` and re-run `align_captions.py`
with `--script` (it refuses if the text drifts from the audio). If
transcription fails entirely, ask the user for the script.

### 2. Research and fact-check

List every factual claim in the narration. For each, find the primary
(ancient) source and a reliable modern reference (Wikipedia via the API is
acceptable as a pointer, not as the final authority). Record them in the
episode file's `fact_check:` block with any disputes. Rules:
- Do not add facts the narration doesn't state unless sourced, and keep
  on-screen text to identifications (what/where/when), not new claims.
- If the narration itself contains an error, tell the user in the delivery
  summary (don't silently "fix" their voice-over).
- Soften labels where scholarship is uncertain ("traditionally identified as",
  "approximate route", "schematic").

### 3. Plan scenes (from the narration)

Copy `episode.template.yaml` to `episodes/<id>.yaml`. One scene per sentence
or narrative beat; cut in the gaps between sentence times; 2–6 s per still,
longer for maps/diagrams. First scene starts at 0, last ends at the master
duration (`build_props.py` checks both). Choose, per beat:

1. authentic material that shows what is being said (site, object, document,
   period artwork), else
2. an original `map` (where/when/movement), `tactics` diagram (how), or
   `illustration` (what it looked like, generically).

Scene kinds:
- `image` — `fit: cover` for photos that tolerate cropping, `fit: contain-blur`
  for artworks, coins, documents (never crop art).
- `map` — `camera` keyframes (lon/lat/span), `markers`, `routes`, `texts`,
  optional `title`, `note`. Basemap: `build_basemap.py --bbox W S E N`.
- `tactics` — double-envelopment schematic (Cannae-type). For a different
  battle shape, add a new component in `remotion-composer/src/historical-short/`
  following `TacticsSceneView.tsx`, keyed to narration times.
- `illustration` — `variant: armies-facing` (two armies on a plain at dusk,
  generic silhouettes). Add variants (fortress, fleet, city) the same way when
  an episode needs them.

### 4. Assets and licences

```bash
python scripts/historical_short/fetch_commons.py search "<query>" --limit 15
python scripts/historical_short/fetch_commons.py info "File:<title>"
python scripts/historical_short/fetch_commons.py fetch "File:<title>" --id <asset_id> --out projects/<id>/assets/images
python scripts/historical_short/build_basemap.py --bbox W S E N --out projects/<id>/assets/maps/basemap.json
```

- Prefer PD / CC0 museum releases (Met, Yale, BnF, Louvre via Commons) to
  CC BY-SA user photos when quality is similar — fewer obligations.
- Read each provenance `description` (what it really shows, date, museum) and
  `restrictions`. **`ita-mibac`**: Italy's Cultural Heritage Code
  (D.Lgs. 42/2004 arts. 107–108) may require permission/fees from the
  institution for commercial reproduction of Italian state-held cultural
  property, independent of the photo licence — note it in the delivery.
- Look at every image (Read the file) before using it; reject anything that
  doesn't match the label.

### 5. Build, render, QC

```bash
python scripts/historical_short/build_props.py --episode scripts/historical_short/episodes/<id>.yaml --project projects/<id>
python scripts/historical_short/render.py --project projects/<id> --draft   # 540x960, fast
python scripts/historical_short/render.py --project projects/<id>           # 1080x1920 final
```

`render.py` checks 1080x1920, 30/1 fps, H.264, audio present, duration vs
master (±0.1 s) and writes a contact sheet. Then also verify yourself:
- Read the contact sheet and a few full-size frames: no blank or unrelated
  scene, labels/captions don't collide, artworks uncropped and labelled.
- Captions = transcript/script words (`captions.json` report: similarity 1.0,
  no interpolated words, or explain).
- Audio: `ffmpeg -i final.mp4 -af ebur128=peak=true -f null -` → integrated
  ≈ -16 LUFS, true peak ≤ -1 dBTP.

### 6. Deliver

Send the MP4 (`SendUserFile`, `display: "attach"`), then a short summary:
scenes and what each shows, the licence/attribution table (from
`CREDITS.txt`, ready to paste into the YouTube description), any flagged
rights or accuracy caveats, and the list of uncommitted repo changes. Ask
before committing.

## Known Limits

- Natural Earth shows modern coastlines; map notes say so; routes are "approximate".
- Diagrams/illustrations are schematic and generic by design.
- Caption timing comes from Whisper word timestamps (≈ ±0.1 s).
