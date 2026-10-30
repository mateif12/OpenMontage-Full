# Historical Short Profile - Documentary Montage Pipeline

A reusable, mostly automated profile of the `documentary-montage` pipeline for
**narrated vertical YouTube Shorts about history**. The user gives you **an MP3
narration and a topic**; you deliver **a finished 1080x1920 MP4**. Everything
needed is in this repository — do not rely on any earlier conversation.

Worked examples: *The Battle of Cannae (216 BC)*
(`scripts/historical_short/episodes/battle-of-cannae.yaml`, legacy v1 episode)
and *The Battle of Waterloo (1815)*, which drove the v2 upgrade (cinematic
painting camera, period-aware battle illustrations, rules that keep maps in a
supporting role). Target: **≈20-30 min per episode** on a 4-vCPU cloud box.

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
  Episode files, media and renders live in gitignored `projects/<id>/`.
- **Free, local tools only.** No paid APIs, credit-consuming generators or
  subscriptions.
- **Deliver** `projects/<id>/renders/final.mp4` with `SendUserFile`
  (`display: "attach"`), plus the credits text for the YouTube description.

### Visual standard

| Rule | How the workflow enforces it |
|------|------------------------------|
| Battle beats show **people fighting** — period soldiers, cavalry, artillery, smoke, action — not lines on a map | `episode_rules.py`: a sentence about combat may not be carried mainly by a map/diagram (error in v2 episodes); `plan_scenes.py` tags combat beats |
| Maps/diagrams **support** the story | ≤ 25 % of runtime, ≤ 7 s per map, never two in a row (errors in v2) |
| Cinematic, never a slideshow | painting **camera paths** (detail shots, pans, full reveal), **depth-layer parallax**, **fx** (powder smoke, muzzle flashes on narrated words, embers, dust, flicker), transitions (crossfade, cut, dip, flash, smoke, whip), film grain |
| Authentic material first | curated **asset packs** + **library** of verified Commons records (`scripts/historical_short/library/`), then `fetch_commons.py search` |
| Original visuals where no authentic image fits | `battle` scenes: code-drawn, **period-aware** figures and templates from **period kits** (`styles/periods/*.yaml`); optional local **AI-assisted** painting pass over those plates |
| Never misrepresent | every scene carries a label: `PAINTING, <year> · ARTISTIC INTERPRETATION`, `… · DETAIL` for crops, `SITE PHOTO`, `ORIGINAL MAP`, `ORIGINAL ILLUSTRATION · ARTISTIC INTERPRETATION`, `AI-ASSISTED ILLUSTRATION · ARTISTIC INTERPRETATION` |
| Artworks are never distorted | uniform scale only; crops must say DETAIL and each artwork should be seen whole once (warnings) |
| AI images are accurate or not used | `generate_illustration.py` writes `review.status: pending`; `build_props.py` refuses AI images without an **approved review with notes**; label must say AI-assisted |
| No reenactments, film clips, unrelated stock, AI video or AI voice | never call video/TTS generators; narration is the user's MP3 |
| Commercial-use licences verified | licence gate (PD, CC0, CC BY, CC BY-SA) + provenance JSON per file + `CREDITS.txt` |

### Technical defaults

9:16 · 1080x1920 · 30 fps · H.264 MP4 (crf 16) · narration normalised to
-16 LUFS / -1.5 dBTP with a 0.5 s lead-in and 1.2 s tail · captions
word-by-word, Space Grotesk on a dark plate, bottom edge ≈1365 px (above the
Shorts UI) · no music; optional quiet original ambience · film grain 0.5 in v2
episodes · no logos/watermarks.

### Approved deviations from documentary-montage defaults

Narration ON (user MP3); music none (ambience optional); end tag opted out;
stills + original animation instead of stock clips; local AI image generation
allowed **only** as labelled, reviewed artistic interpretation (user decision,
2026-10-30); render via `video_compose` with `render_runtime: "remotion"`
(custom composition `remotion-composer/src/historical-short/entry.tsx`).
HyperFrames is not supported on documentary-montage.

## Files

| Path (tracked) | Role |
|---|---|
| `HISTORICAL_SHORTS.md` | one-page quick start |
| `skills/pipelines/documentary-montage/historical-short.md` | this guide |
| `styles/historical-documentary.yaml` | style playbook |
| `styles/periods/*.yaml` | **period kits** (8 eras: uniforms, headgear, weapons, artillery, terrain, buildings, palette, AI vocabulary + anachronism negatives) |
| `scripts/historical_short/new_episode.py` | **entry point**: project, audio master, transcription, captions, ambience, brief, scene-plan skeleton |
| `scripts/historical_short/plan_scenes.py` | scene skeleton: cuts in pauses, period, combat/place/person tags, pack candidates |
| `scripts/historical_short/periods.py` | period detection (topic year) + kit loading |
| `scripts/historical_short/fetch_commons.py` | Commons search / `fetch-list` batch (library → cache → one API call; curl transport; fail-fast) / `library-add` |
| `scripts/historical_short/library/` | text-only: `commons/*.json` verified metadata, `packs/<period>.yaml` curated assets with label defaults |
| `scripts/historical_short/episode_rules.py` | pre-render storytelling + layout checks (run by build_props) |
| `scripts/historical_short/make_layers.py` | depth layers for parallax (Depth-Anything-V2-Small ONNX, Apache-2.0, CPU) |
| `scripts/historical_short/generate_illustration.py` | local AI painting pass over a battle plate + review gate |
| `scripts/historical_short/build_basemap.py` | Natural Earth coastlines (continental maps) |
| `scripts/historical_short/build_terrain.py` | shaded relief from Copernicus GLO-30 (battlefield maps) |
| `scripts/historical_short/align_captions.py`, `make_ambience.py` | captions, ambience |
| `scripts/historical_short/build_props.py` | episode → props + `CREDITS.txt`; resolves kits/sides/layers/backdrops; validation |
| `scripts/historical_short/render.py` (+ `preview_stills.mjs`) | `--preview` stills (one bundle) / single final render + QC |
| `scripts/historical_short/regression_render.py` | visual regression (Cannae, legacy scenes) |
| `scripts/historical_short/episode.template.yaml` | v2 template with every scene kind |
| `scripts/historical_short/requirements.txt` | extra Python deps for this profile |
| `remotion-composer/src/historical-short/` | composition: `ImageSceneView` (camera/parallax), `BattleSceneView` + `figures.tsx`, `MapSceneView`, `FxLayer`, legacy `TacticsSceneView`/`IllustrationSceneView` |
| `tests/historical_short/` | network-free unit + regression tests |

Generated (gitignored): `projects/<id>/` — episode.yaml, audio, images, layers,
maps, artifacts, renders. Model/data caches: `~/.cache/huggingface`,
`~/.cache/openmontage/{commons,dem}`.

## Environment Setup (fresh cloud container — do it yourself, silently)

```bash
pip install -r requirements.txt -r scripts/historical_short/requirements.txt
cd remotion-composer && npm install && cd ..
```

- Downloads on first use (cached afterwards): Whisper small (~0.5 GB),
  Depth-Anything-V2-Small (~0.1 GB), LCM-Dreamshaper-v7 OpenVINO int8
  (~2.3 GB, only if AI illustrations are used), Copernicus DEM tiles (~32 MB
  each), Natural Earth (~10 MB).
- Hugging Face downloads need `HF_HUB_DISABLE_XET=1` (the Xet CDN is often
  blocked); the scripts set it. `download.pytorch.org` is blocked in some
  sandboxes — nothing here needs PyTorch.
- Hosts: `commons.wikimedia.org`, `upload.wikimedia.org`, `en.wikipedia.org`,
  `huggingface.co`, `naturalearth.s3.amazonaws.com`,
  `copernicus-dem-30m.s3.amazonaws.com`. If one is denied, tell the user which
  host and that they can allow it in the environment's network settings.
- Wikimedia throttles shared IPs. Measured: python-requests downloads got HTTP
  429 while curl fetched the same URLs instantly, so `fetch_commons.py`
  downloads with curl and fails fast (≈40 s), retrying smaller standard widths.
  The **metadata API** is the scarce resource: use packs/library first, then
  ONE batched `prefetch`/`fetch-list` call for new titles.

## Process (target 20-30 min)

### 1. Set up the episode (≈2 min)

```bash
python scripts/historical_short/new_episode.py --mp3 <path.mp3> --topic "<Topic (year)>" --id <kebab-id>
```

Transcribes, aligns captions, and writes `projects/<id>/episode.yaml` — a
skeleton with cut points in the pauses, the detected `period`, per-beat
`tags` (combat / place / person / aftermath), a `suggest` hint and
`pack_candidates` (assets from the period pack with label defaults).
Fix recogniser errors in proper nouns only if certain (write
`artifacts/script.txt`, re-run `align_captions.py --script`).

### 2. Research and fact-check (≈5 min, in parallel with step 4 downloads)

List every factual claim; record sources and disputes in `fact_check:`.
Don't add facts the narration doesn't state; keep on-screen text to
identifications. If the narration contains an error or simplification, tell the
user in the delivery summary (don't "fix" their voice-over). Soften labels
where scholarship is uncertain.

### 3. Fill the scene plan (≈5-8 min)

Replace every `kind: TODO`. Choose per beat, in this order:

1. **Authentic artwork/photo that shows the beat**, animated:
   `camera:` keys `{t, x, y, zoom}` — `x,y` = image point (0..1) at the frame
   focus; `zoom: fit` = whole image, `zoom: cover` = fills 9:16, `"cover*1.3"`
   closer. Add `depth_layers: 3` for parallax and `fx:` for atmosphere. Crops
   get `· DETAIL` in the label tag; reveal each artwork whole once.
2. **Code-drawn battle illustration** when no authentic image shows the
   action: `kind: battle`, `template:` one of `line-advance`, `volley`,
   `cavalry-charge`, `artillery`, `assault`, `aftermath`, `armies-facing`
   (the period kit lists which exist), `left/right: {faction: <preset>}`,
   `fireAt: [<times of narrated words>]`, `camera: {from, to, zoom}`.
3. **Optional AI-assisted painting** of a battle plate (slow: ≈1.5 min each):
   `generate_illustration.py paint --scene <battle id> --at <t> --id <asset>`,
   **look at it**, then `review --approve|--reject --notes "<what you checked>"`;
   use it as an `image` scene (label tag must say AI-ASSISTED). Reject anything
   with wrong uniforms/weapons, anachronisms or malformed figures — measured
   failure modes at strength ≥ 0.5: infantry repainted as riders, coat colours
   lost. Defaults (strength 0.3 + colour lock 0.8) keep the plate's composition
   and the kit's colours.
4. **Map / tactical diagram** only for where/when/movement beats:
   `kind: map` with `units` (moving blocks: `side`, `kind`, `keys`), `routes`
   (`arrow`, `style: retreat`, `width`, `side`), `markers` (`style: fort|battle|city|capital`),
   `terrain:` (build_terrain.py) for battlefield scale, `tilt:` 0-30.
   Episode-level `sides: {name: "#hex"}` colours units/routes.

Images: `fit`/`zoomFrom`/`zoomTo`/`panY` (legacy) still work; prefer `camera`.
Transitions: `transition: crossfade|cut|dip|flash|smoke|whip` (flash on gunfire,
smoke into battle scenes, whip for quick cuts, dip for time jumps).

### 4. Assets (≈2-4 min)

```bash
python scripts/historical_short/fetch_commons.py fetch-list --pack <period> --ids a,b,c --out projects/<id>/assets/images
python scripts/historical_short/fetch_commons.py search "<query>" --limit 15        # only if the pack lacks a beat
python scripts/historical_short/fetch_commons.py fetch-list --list ids.txt --out projects/<id>/assets/images
python scripts/historical_short/build_terrain.py --bbox W S E N --out projects/<id>/assets/maps/terrain
python scripts/historical_short/build_basemap.py --bbox W S E N --out projects/<id>/assets/maps/basemap.json
```

Look at every image before use (Read the file); `reviewed: false` pack
entries especially. Prefer 1920 px sources (default) for detail shots.
After the episode, add new verified titles to the library/pack
(`fetch_commons.py library-add`, edit `packs/<period>.yaml`) — text only.
**`ita-mibac`** restrictions: note in the delivery (Italian cultural-heritage
rules may need institutional permission for commercial use).

### 5. Build, preview, render once (≈10 min)

```bash
python scripts/historical_short/build_props.py --episode projects/<id>/episode.yaml --project projects/<id>
python scripts/historical_short/render.py --project projects/<id> --preview     # ≈30 s, 2 stills/scene
python scripts/historical_short/render.py --project projects/<id>               # final, ≈6-8 min
```

`build_props.py` fails on errors (v2) and prints warnings — fix layout
warnings before previewing. Read `renders/preview_sheet.jpg`; fix and repeat
build+preview (cheap). Render the final **once**. `render.py` checks
1080x1920, 30 fps, H.264, audio, duration (±0.1 s), loudness, black frames and
writes a contact sheet. Then verify yourself: contact sheet + a few full-size
frames; captions = narration words; `ebur128` ≈ -16 LUFS.

### 6. Deliver

Send the MP4 (`SendUserFile`, `display: "attach"`), then: scenes and what
each shows, the credits (from `CREDITS.txt`), flagged rights/accuracy caveats
(including narration simplifications and any AI-assisted images and their
review notes), and the list of uncommitted repo changes. Ask before committing.

## Measured performance (4 vCPU, 15 GB RAM, no GPU; 2026-10-30)

| Step | Time |
|---|---|
| Whisper transcription (58 s MP3) | 46 s |
| `fetch-list`, pack/library metadata | ≈5-20 s per image (no API call) |
| Depth layers per image | ≈8 s (first run + model download ≈ 1 min) |
| Preview, 34 stills | 24 s |
| Final render, per frame | painting camera/parallax/fx 0.13-0.15 s · battle 0.20-0.22 s · terrain map 0.18 s · legacy letterbox 0.20 s |
| AI-assisted painting (LCM img2img 576x1024) | ≈90-110 s per image incl. plate + model load |

## Known Limits

- Code-drawn battle illustrations are stylised (graphic-novel silhouettes),
  generic figures — not portraits or regiment-accurate uniforms. The AI pass
  adds painterly texture but must be reviewed; it is not reliable for specific
  insignia, faces or complex poses.
- Better text-to-image models (e.g. FLUX.1-schnell int4) were OOM-killed on a
  15 GB machine; only LCM-Dreamshaper-v7 is practical on CPU.
- Natural Earth = modern coastlines; Copernicus DEM = modern, smoothed terrain
  (map notes say so); unit positions and routes are schematic/approximate.
- Caption timing from Whisper word timestamps (≈ ±0.1 s).
