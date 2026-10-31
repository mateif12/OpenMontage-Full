import { Config } from "@remotion/cli/config";

// Offline / sandboxed machines cannot download Remotion's headless browser.
// When REMOTION_BROWSER_EXECUTABLE points at a local Chromium, use it
// (scripts/historical_short/render.py sets it to /opt/pw-browsers/chromium).
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}

// Opt-in broadcast-safe output (limited-range yuv420p, BT.709 tags) for
// renders that will be delivered as standard H.264 files. PNG frame capture
// avoids the full-range yuvj420p output of the default JPEG pipeline.
// Set by scripts/historical_short/render.py --landscape.
if (process.env.REMOTION_BROADCAST_COLOR === "1") {
  Config.setVideoImageFormat("png");
  Config.setPixelFormat("yuv420p");
  Config.setColorSpace("bt709");
}
