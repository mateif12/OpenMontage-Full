import { FactionKit } from "./figures";
// Props contract for the HistoricalShort composition (documentary-montage
// historical-short profile). Built by scripts/historical_short/build_props.py
// from an episode.yaml; all times are absolute seconds in the narration MP3.

import { WordCaption } from "../components/CaptionOverlay";

export interface SourceLabel {
  // Short uppercase category, e.g. "MUSEUM ARTIFACT", "PAINTING, 1773 · ARTISTIC INTERPRETATION"
  tag: string;
  title: string;
  detail?: string;
  // Licence / attribution line, e.g. "Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons"
  credit?: string;
}

// Cinematic effects drawn over a scene (FxLayer.tsx). All times absolute seconds.
export interface FxFlash {
  t: number; // when the muzzle flash / explosion fires
  x: number; // 0..1 of the frame
  y: number;
  size?: number; // px radius, default 220
  smoke?: boolean; // leave a growing smoke puff (default true)
}

export interface FxSpec {
  smoke?: number; // 0..1 drifting powder smoke
  smokeColor?: string;
  flashes?: FxFlash[];
  embers?: number; // 0..1 rising sparks (fires, burning buildings)
  dust?: number; // 0..1 drifting dust motes
  flicker?: number; // 0..1 light flicker (firelight / gun flashes)
  rays?: number; // 0..1 light shafts through smoke
}

// How the scene enters (applies at its start).
export type SceneTransition = "crossfade" | "cut" | "dip" | "flash" | "smoke" | "whip";

interface SceneBase {
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  transition?: SceneTransition;
  fx?: FxSpec;
}

export interface ImageScene extends SceneBase {
  kind: "image";
  src: string;
  // cover: fill the 9:16 frame (crop). contain-blur: show the whole image over a
  // blurred copy of itself (use for artworks so they are not cropped).
  fit?: "cover" | "contain-blur";
  focusX?: number; // 0..1 object-position for cover
  focusY?: number;
  zoomFrom?: number;
  zoomTo?: number;
  panX?: [number, number]; // px offset start -> end
  panY?: [number, number];
  // Set by build_props.py: pre-blurred backdrop and the image's pixel size.
  blurSrc?: string;
  imageSize?: [number, number];
  // Cinematic camera over the painting (replaces fit/zoom/pan when present).
  // x,y: image point (0..1) placed at the frame's focus; zoom 1 = whole image
  // visible (contain), larger = closer. Uniform scale only — never distorts.
  camera?: ImageCameraKey[];
  // 2.5D parallax: depth layers cut from the same image (make_layers.py).
  // Layers share the camera; nearer layers drift further.
  layers?: ImageLayer[];
  parallax?: number; // px of drift for depth 1 over the scene (default 36)
  parallaxDir?: [number, number]; // drift direction, default [1, 0.15]
}

export interface ImageCameraKey {
  t: number; // absolute seconds
  x: number;
  y: number;
  zoom: number;
}

export interface ImageLayer {
  src: string; // RGBA PNG (or JPG for the backmost layer), same size as the image
  depth: number; // 0 = far ... 1 = near
}

export interface MapCameraKey {
  t: number; // absolute seconds
  lon: number;
  lat: number;
  span: number; // degrees of longitude visible across the frame width
}

export interface MapMarker {
  lon: number;
  lat: number;
  label: string;
  at: number; // absolute seconds it appears
  // capital-rome / capital-carthage are legacy aliases (red / gold capital)
  style?: "city" | "battle" | "capital" | "fort" | "capital-rome" | "capital-carthage";
  labelSide?: "left" | "right" | "above" | "below";
  color?: string;
}

export interface MapRoute {
  points: [number, number][]; // [lon, lat]
  from: number; // absolute seconds draw starts
  to: number; // absolute seconds draw ends
  label?: string;
  color?: string;
  arrow?: boolean; // arrowhead at the drawn tip
  style?: "attack" | "march" | "retreat"; // retreat = dashed
  width?: number; // px, default 5
}

// Moving unit block (NATO-style symbol) on a map/tactical diagram.
export interface MapUnitKey {
  t: number; // absolute seconds
  lon: number;
  lat: number;
}

export interface MapUnit {
  label?: string;
  color: string; // resolved from the episode's `sides` by build_props.py
  kind?: "infantry" | "cavalry" | "artillery";
  keys: MapUnitKey[];
  w?: number; // px
  h?: number; // px
  at?: number; // appears (absolute s)
  until?: number; // fades out (absolute s)
}

export interface MapText {
  lon: number;
  lat: number;
  text: string;
  at: number;
  color?: string;
  size?: number; // px
}

export interface MapScene extends SceneBase {
  kind: "map";
  basemap?: string; // JSON from build_basemap.py, relative to public dir; omit/"none" = plain land
  terrain?: string; // JSON from build_terrain.py (shaded relief), relative to public dir
  tilt?: number; // degrees of 3D tilt of the map plane (0-35)
  units?: MapUnit[];
  camera: MapCameraKey[];
  markers?: MapMarker[];
  routes?: MapRoute[];
  texts?: MapText[];
  title?: { text: string; sub?: string; at: number; until?: number };
  // Small identification line for scenes without a label card,
  // e.g. "ORIGINAL MAP · modern coastlines: Natural Earth (public domain)".
  note?: string;
}

export interface TacticsTimes {
  centreBack: [number, number];
  advance: [number, number];
  wheel: [number, number];
  cavalry: [number, number];
  trapped: number;
  flankHighlight?: [number, number];
}

export interface TacticsScene extends SceneBase {
  kind: "tactics";
  times: TacticsTimes;
  heading?: string;
  note?: string;
}

// Original illustration (generic silhouettes, never a reconstruction of
// specific equipment). variant "armies-facing": two armies across a plain.
export interface IllustrationScene extends SceneBase {
  kind: "illustration";
  // armies-facing: two armies across a plain at dusk
  // aftermath: abandoned shields and broken spears, drifting smoke (no bodies)
  variant: "armies-facing" | "aftermath";
  leftLabel?: string;
  rightLabel?: string;
  leftRows?: number;
  leftPerRow?: number;
  rightRows?: number;
  rightPerRow?: number;
}

// Code-drawn, period-aware battle illustration (BattleSceneView). build_props.py
// resolves `period` + faction presets from styles/periods/<id>.yaml into `kit`
// and `left/right.faction`, so the composition never reads YAML.
export interface BattleKit {
  id: string;
  name: string;
  palette: {
    sky_top: string;
    sky_bottom: string;
    light: string;
    haze: string;
    ground_far: string;
    ground_near: string;
    smoke: string;
    shadow: string;
  };
  environment: { terrain?: string; vegetation?: string[]; buildings?: string[] };
  artillery: { type: "none" | "smoothbore" | "rifled" | "modern"; barrel?: string; carriage?: string; crew?: FactionKit };
}

export interface BattleSide {
  faction: FactionKit;
  cavalry?: FactionKit;
  count?: number;
}

export type BattleTemplate =
  | "line-advance"
  | "volley"
  | "cavalry-charge"
  | "artillery"
  | "assault"
  | "aftermath"
  | "armies-facing";

export interface BattleScene extends SceneBase {
  kind: "battle";
  template: BattleTemplate;
  kit: BattleKit;
  left: BattleSide; // main subject, facing right
  right?: BattleSide; // opponent, facing left, in the distance
  fireAt?: number[]; // absolute seconds: volleys / gun shots on narrated words
  camera?: { from?: number; to?: number; zoom?: number }; // dolly in world px, end zoom
  building?: string;
  seed?: string;
}

export type HistoricalScene = ImageScene | MapScene | TacticsScene | IllustrationScene | BattleScene;

export interface GlobalFx {
  grain?: number; // 0..1 film grain over everything (default 0.5)
  grainSrcs?: string[]; // grain tiles written by build_props.py
}

export type HistoricalShortProps = {
  globalFx?: GlobalFx;
  // Clean plate: scene artwork only (no labels, captions, grading, grain, audio).
  // Used by generate_illustration.py to feed the local AI painting pass.
  plate?: boolean;
  durationSeconds: number;
  narrationSrc: string;
  ambienceSrc?: string;
  ambienceVolume?: number;
  scenes: HistoricalScene[];
  captions: WordCaption[];
  captionStyle?: {
    fontSize?: number;
    wordsPerPage?: number;
    highlightColor?: string;
    bottomOffset?: number; // px from bottom of frame to the caption block's bottom edge
  };
};
