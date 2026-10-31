// Props contract for the HistoricalDocumentary composition — the landscape
// (1920x1080) variant of the documentary-montage historical profile.
// Built by scripts/historical_short/build_props.py from an episode.yaml; every
// time value is an absolute second on the narration master clock.

import { ImageScene, SourceLabel } from "../historical-short/types";

export type { SourceLabel };

export interface WordCaption {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleCue {
  start: number; // seconds
  end: number;
  lines: string[];
}

export interface TitleOverlay {
  text: string;
  sub?: string;
  at: number;
  until?: number;
}

interface SceneExtras {
  title?: TitleOverlay;
  labelAt?: number; // absolute second the label card appears (default: scene start)
  grade?: "warm" | "cool" | "none";
}

export type DocImageScene = ImageScene & SceneExtras;

// ---------------------------------------------------------------- maps
export interface MapCameraKey {
  t: number;
  lon: number;
  lat: number;
  span: number; // degrees of longitude across the frame width
}

export interface DocMapMarker {
  lon: number;
  lat: number;
  label: string;
  sub?: string;
  at: number;
  until?: number;
  style?: "base" | "battle" | "camp" | "city" | "uncertain";
  labelSide?: "left" | "right" | "above" | "below";
  abandonedAt?: number; // draws a strike + "abandoned" state from this second
}

export interface DocMapRoute {
  points: [number, number][];
  from: number;
  to: number;
  until?: number;
  label?: string;
  color?: string;
  dashed?: boolean;
  width?: number; // px on screen
  arrow?: boolean;
}

export interface DocMapText {
  lon: number;
  lat: number;
  text: string;
  at: number;
  until?: number;
  color?: string;
  size?: number; // px on screen
  italic?: boolean;
  spacing?: number;
}

export interface DocMapArea {
  points: [number, number][];
  at: number;
  until?: number;
  color?: string;
  hatch?: boolean;
}

export interface DocMapRiverStyle {
  names: string[]; // Natural Earth names to highlight
  at: number;
  color?: string;
  width?: number;
}

export interface DocMapScene extends SceneExtras {
  kind: "map";
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  basemap: string;
  camera: MapCameraKey[];
  markers?: DocMapMarker[];
  routes?: DocMapRoute[];
  texts?: DocMapText[];
  areas?: DocMapArea[];
  riverHighlights?: DocMapRiverStyle[];
  heading?: { tag: string; text: string; at?: number };
  notes?: { text: string; at: number; until?: number }[];
  footnote?: string;
}

// ------------------------------------------------- battle reconstruction
export interface BattleCameraKey {
  t: number;
  x: number; // world units (world is 3200 x 1800)
  y: number;
  zoom: number; // screen px per world unit (0.6 = whole world)
}

export interface BattleTimes {
  wardsIn: number; // hidden warbands appear
  sightlines: [number, number];
  wall: number; // turf wall marker appears
  columnEnter: number; // column head enters at the east edge
  marchUntil: number; // column halts (ambush)
  rain: [number, number];
  callouts: [number, number]; // unit-type callouts visible
  stretched: number; // "no room to deploy" bracket
  attack: number; // first assault
  missiles: [number, number];
  spread: [number, number]; // ambush spreads along the route
  regroup: [number, number]; // Roman units try to close up
  inset: [number, number]; // open-field vs forest-track inset
  collapse: [number, number];
  eagles: [number, number, number]; // the three legions marked destroyed
  aftermath?: number; // warbands withdraw, abandoned equipment remains
}

export interface BattleHeading {
  at: number;
  tag: string;
  text: string;
  sub?: string;
}

export interface BattleScene extends SceneExtras {
  kind: "battle";
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  times: BattleTimes;
  camera: BattleCameraKey[];
  headings: BattleHeading[];
  footnote?: string;
  notes?: { text: string; at: number; until?: number; tag?: string }[];
  days?: { at: number; label: string }[]; // day-sequence ticker
  hideHeading?: boolean;
}

// ------------------------------------------------------------- end card
export interface EndCardScene extends SceneExtras {
  kind: "endcard";
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  background?: string; // image src (public dir)
  heading: string;
  sub?: string;
  lines: string[];
}

// ------------------------------------------------- people (no portraits)
export interface ProfileCard {
  name: string;
  role: string;
  facts: string[];
  source: string;
  emblem: "roman-standard" | "germanic-shield";
  at: number;
  factsAt?: number;
}

export interface ProfilesScene extends SceneExtras {
  kind: "profiles";
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  left: ProfileCard;
  right: ProfileCard;
  link: { text: string; at: number };
  footnote?: string;
}

// ------------------------------------------------- the three legions
export interface LegionsScene extends SceneExtras {
  kind: "legions";
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
  heading: string;
  legions: { name: string; at: number }[];
  struckAt: number;
  note?: { text: string; at: number };
  footnote?: string;
}

export type DocScene = DocImageScene | DocMapScene | BattleScene | EndCardScene | ProfilesScene | LegionsScene;

export type HistoricalDocumentaryProps = {
  durationSeconds: number;
  narrationSrc: string;
  ambienceSrc?: string;
  ambienceVolume?: number;
  scenes: DocScene[];
  captions: WordCaption[];
  subtitleCues?: SubtitleCue[];
};
