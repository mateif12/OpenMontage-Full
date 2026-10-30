# Period kits (historical-short workflow)

One YAML per era. Used by the code-drawn battle illustrations
(`remotion-composer/src/historical-short/BattleSceneView.tsx`) and by local AI
illustration prompts (`scripts/historical_short/generate_illustration.py`).
Selected automatically from the topic year (`scripts/historical_short/periods.py`);
an episode can override with `period:` and pick faction presets per side.

Schema (all colours hex):
- `id`, `name`, `years`, `notes` — what the kit covers and its simplifications
- `palette` — sky/ground/haze/smoke/light colours for illustrations
- `environment` — `terrain` (rolling | plain | hills | trenches | ruins | coast), `vegetation`, `buildings`
- `factions.<preset>` — one uniform/kit per preset: `label`, `role` (infantry | cavalry | archer | pike),
  `coat`, `facings`, `trousers`, `coat_style` (tails | tunic | long | breastplate | greatcoat | jacket),
  `headgear` (see figures.tsx), `headgear_color`, `plume`, `belts` (cross | single | none),
  `weapon` (musket | rifle | pike | spear | sword | sabre | lance | bow), `shield` (none | round | scutum | kite | aspis),
  `shield_color`, `skin_shadow`, `horse` (cavalry), `flag` (list of stripe colours + `flag_orientation`)
- `artillery` — `type` (none | smoothbore | rifled | modern), `barrel`, `carriage`
- `templates` — battle templates this era supports
- `ai` — `style`, `positive` vocabulary, `negative` anachronisms for local AI prompts

Colours are representative, simplified period colours for generic figures —
not reconstructions of specific regiments. Labels on screen always say so.
