// Fast review stills for a historical Short: bundle the composition ONCE, open
// the browser ONCE, then render one still per requested time. Replaces the
// half-resolution draft video (≈3.5 min on 4 vCPU) with ≈1 min of stills.
//
// Part of the historical-short workflow
// (skills/pipelines/documentary-montage/historical-short.md). Called by
// render.py --preview; can be run directly:
//   node scripts/historical_short/preview_stills.mjs <props.json> <publicDir> <outDir> <scale> <t1,t2,...>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const composer = path.resolve(here, "../../remotion-composer");
const require = createRequire(path.join(composer, "package.json"));
const { bundle } = require("@remotion/bundler");
const { selectComposition, renderStill, openBrowser } = require("@remotion/renderer");

const [propsPath, publicDir, outDir, scaleArg, timesArg] = process.argv.slice(2);
const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));
const scale = Number(scaleArg || 0.5);
const times = timesArg.split(",").map(Number);
fs.mkdirSync(outDir, { recursive: true });

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
const serveUrl = await bundle({
  entryPoint: path.join(composer, "src/historical-short/entry.tsx"),
  publicDir: path.resolve(publicDir),
});
const browser = await openBrowser("chrome", { browserExecutable });
const composition = await selectComposition({ serveUrl, id: "HistoricalShort", inputProps, puppeteerInstance: browser });
const fps = composition.fps;
for (const t of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * fps)));
  const output = path.join(outDir, `t${t.toFixed(2).padStart(6, "0")}.jpg`);
  await renderStill({ composition, serveUrl, output, frame, inputProps, scale, imageFormat: "jpeg",
    jpegQuality: 85, puppeteerInstance: browser });
  console.log(output);
}
await browser.close({ silent: true });
