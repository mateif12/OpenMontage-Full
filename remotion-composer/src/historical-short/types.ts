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

interface SceneBase {
  id: string;
  start: number;
  end: number;
  label?: SourceLabel;
  fadeIn?: number;
  fadeOut?: number;
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
  style?: "city" | "battle" | "capital-rome" | "capital-carthage";
  labelSide?: "left" | "right" | "above" | "below";
}

export interface MapRoute {
  points: [number, number][]; // [lon, lat]
  from: number; // absolute seconds draw starts
  to: number; // absolute seconds draw ends
  label?: string;
  color?: string;
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
  basemap: string; // JSON from build_basemap.py, relative to public dir
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

export type HistoricalScene = ImageScene | MapScene | TacticsScene | IllustrationScene;

export type HistoricalShortProps = {
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
