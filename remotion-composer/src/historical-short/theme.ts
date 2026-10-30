import { loadPlayfair, loadSpaceGrotesk } from "../lib/localFonts";

// Bundled OFL fonts (no network at render time).
export const serif = loadPlayfair("normal", ["400", "700"]).fontFamily;
export const sans = loadSpaceGrotesk(["400", "500", "700"]).fontFamily;

export const palette = {
  ink: "#0b0d10",
  sea: "#0c1820",
  seaDeep: "#081117",
  land: "#3b3326",
  landEdge: "#9c8657",
  parchment: "#f1e6cc",
  gold: "#d9b25f",
  rome: "#c8372d",
  carthage: "#d9b25f",
  carthageDark: "#a7843c",
  grid: "rgba(241,230,204,0.08)",
};
