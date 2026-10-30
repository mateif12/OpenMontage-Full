# Historical YouTube Shorts — Quick Start

**For the user:** start a new Claude Code session in this repository, attach
your narration MP3, and write the topic, e.g.

> Historical Short. Topic: The Fall of Constantinople (1453). MP3 attached.

Claude does the rest and sends back a finished vertical MP4 plus the credits
to paste into the YouTube description. Nothing is committed or pushed
without your permission. Target time: about 20-30 minutes per episode.

**For the agent:** this is the `documentary-montage` pipeline with the
historical-short profile. Read, in order:

1. `AGENT_GUIDE.md` (mandatory for every session)
2. `skills/pipelines/documentary-montage/historical-short.md` — the complete
   workflow, standing rules, visual standard and commands
3. `scripts/historical_short/episode.template.yaml` — every scene kind
   (painting camera + parallax + fx, period-aware `battle` illustrations,
   tactical maps); `episodes/battle-of-cannae.yaml` is a legacy (v1) example

Entry point (writes the scene-plan skeleton `projects/<id>/episode.yaml`):

```bash
python scripts/historical_short/new_episode.py --mp3 <attached.mp3> --topic "<Topic (year)>" --id <kebab-id>
```

Then: fill the plan → `fetch_commons.py fetch-list --pack <period>` →
`build_props.py` → `render.py --preview` → `render.py` (once).
