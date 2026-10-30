import { Config } from "@remotion/cli/config";

// Offline / sandboxed machines cannot download Remotion's headless browser.
// When REMOTION_BROWSER_EXECUTABLE points at a local Chromium, use it
// (scripts/historical_short/render.py sets it to /opt/pw-browsers/chromium).
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
