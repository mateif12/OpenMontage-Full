// Headless renderer: serves the repo, drives Chromium (WebGL via SwiftShader on
// CPU-only machines), captures frames and encodes with ffmpeg.
//   node render.mjs --scene <scene.json> --out <dir> [--anim] [--stills] [--showcase] [--from t --to t] [--scale 0.5] [--workers 2] [--only N]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const scenePath = path.resolve(args.scene); const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const scale = parseFloat(args.scale || '1'); const W = Math.round(1080 * scale), H = Math.round(1920 * scale);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2' };
// ---- fast path: frames arrive as raw RGBA POSTs and are streamed, in order, into one ffmpeg
const fast = !!args.fast;
const segEnc = new Map(); const SEG = parseInt(args.segment || '0', 10) || 1e9;
const enc = { pending: new Map(), next: 0, proc: null, waiters: [] };
function pump() {
  while (enc.pending.has(enc.next)) {
    const b = enc.pending.get(enc.next); enc.pending.delete(enc.next); enc.next++;
    if (!enc.proc.stdin.write(b)) { enc.proc.stdin.once('drain', pump); break; }
  }
  if (enc.pending.size < 6) { const w = enc.waiters; enc.waiters = []; w.forEach((f) => f()); }
}
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u.startsWith('/frame/') && segEnc.size) {
    // segmented mode: each worker renders one segment sequentially, so frames arrive in order
    const i = parseInt(u.slice(7), 10); const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const e = segEnc.get(Math.floor(i / SEG)); const ok = e.stdin.write(Buffer.concat(chunks)); const done = () => { res.writeHead(200); res.end(); }; ok ? done() : e.stdin.once('drain', done); });
    return;
  }
  if (req.method === 'POST' && u.startsWith('/frame/')) {
    const i = parseInt(u.slice(7), 10); const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { enc.pending.set(i, Buffer.concat(chunks)); pump(); const done = () => { res.writeHead(200); res.end(); }; if (enc.pending.size < 6) done(); else enc.waiters.push(done); });
    return;
  }
  const f = u === '/scene.json' ? scenePath : path.join(ROOT, u);
  if (!f.startsWith(ROOT) && f !== scenePath) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
const port = server.address().port;
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const opt = fast ? { fast: true, iscale: parseFloat(args.iscale || '1'), samples: parseInt(args.samples ?? '4', 10), shadow: parseInt(args.shadow || '4096', 10),
  shadowType: args.shadowtype || 'pcfsoft', cull: !!args.cull, lod: !!args.lod, lodPx: parseFloat(args.lodpx || '70') } : {};
async function page(init) {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  p.on('pageerror', (e) => console.error('PAGE ERROR', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await p.goto(`http://127.0.0.1:${port}/ancient_battles/renderer/index.html`);
  await p.waitForFunction(() => window.ABR && window.ABR.init);
  await p.evaluate(() => document.fonts.load("700 62px 'Space Grotesk'").then(() => document.fonts.load("44px 'Playfair'")).then(() => document.fonts.load("600 25px 'Space Grotesk'")));
  const info = await p.evaluate((o) => window.ABR.init(o), { scene: '/scene.json', width: W, height: H, ...opt, ...init });
  await p.evaluate(() => document.fonts.ready);
  if (scale !== 1) await p.addStyleTag({ content: `#wrap{transform:scale(1)} .ov,.plate{zoom:${scale}}` });
  return { p, info };
}

const t0 = Date.now();
if (args.showcase) {
  for (const sc of scene.poc.showcase) {
    const { p } = await page({ mode: 'showcase', showcase: sc.id });
    await p.evaluate(() => window.ABR.frame(1.0));
    await p.screenshot({ path: path.join(out, sc.id + '.png') }); await p.close(); console.log('showcase', sc.id, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
if (args.stills) {
  const { p, info } = await page({ mode: 'battle' }); console.log('battle', info);
  for (const st of scene.poc.stills) {
    await p.evaluate((st) => window.ABR.frame(st.t, { shot: st, captions: false }), st);
    await p.screenshot({ path: path.join(out, st.id + '.png') }); console.log('still', st.id, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  if (args.shotstills) for (const sh of scene.poc.shots) for (const f of [0.15, 0.85]) {
    const t = sh.start + (sh.end - sh.start) * f;
    await p.evaluate((t) => window.ABR.frame(t), t);
    await p.screenshot({ path: path.join(out, `shot_${sh.id}_${f}.png`) }); console.log('shot', sh.id, f, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  await p.close();
}
if (args.anim && fast && args.segment) {
  // Resumable segmented render: segments of SEG frames are encoded independently (visually
  // lossless intermediate), finished segments are skipped on restart, then concatenated
  // and muxed with the WHOLE narration MP3 (never trimmed or re-timed).
  const rng0 = scene.poc[args.range || 'final'] || scene.poc.animation;
  const from = parseFloat(args.from ?? rng0.start), to = parseFloat(args.to ?? rng0.end), fps = 30;
  const n = Math.round((to - from) * fps); const workers = parseInt(args.workers || '2', 10);
  const sdir = path.join(out, 'segments'); fs.mkdirSync(sdir, { recursive: true });
  const nseg = Math.ceil(n / SEG); const queue = [];
  for (let k = 0; k < nseg; k++) if (!fs.existsSync(path.join(sdir, `seg_${String(k).padStart(3, '0')}.done`))) queue.push(k);
  console.log(`frames ${n}, segments ${nseg}, to render ${queue.length}, workers ${workers}`);
  await Promise.all(Array.from({ length: workers }, async () => {
    const { p } = await page({ mode: 'battle' });
    while (queue.length) {
      const k = queue.shift(); const a = k * SEG, b = Math.min(n, a + SEG); const tag = String(k).padStart(3, '0');
      const segFile = path.join(sdir, `seg_${tag}.mp4`); const ts = Date.now();
      const proc = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', '30', '-i', '-', '-vf', 'vflip',
        '-c:v', 'libx264', '-preset', args.preset || 'veryfast', '-crf', args.crf || '14', '-pix_fmt', 'yuv420p', '-r', '30', segFile], { stdio: ['pipe', 'inherit', 'inherit'] });
      const closed = new Promise((r) => proc.on('close', r));
      segEnc.set(k, proc);
      for (let i = a; i < b; i++) {
        await p.evaluate((t) => window.ABR.frame(t), from + i / fps);
        await p.evaluate((i) => window.ABR.capture(i), i);
      }
      proc.stdin.end(); const code = await closed; segEnc.delete(k);
      if (code !== 0) throw new Error(`segment ${k} encoder exit ${code}`);
      fs.writeFileSync(path.join(sdir, `seg_${tag}.done`), JSON.stringify({ frames: b - a, seconds: (Date.now() - ts) / 1000 }));
      console.log(`segment ${k + 1}/${nseg} frames ${a}-${b - 1} ${((Date.now() - ts) / 1000 / (b - a)).toFixed(2)} s/frame  elapsed ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    }
    await p.close();
  }));
  const list = path.join(sdir, 'list.txt');
  fs.writeFileSync(list, Array.from({ length: nseg }, (_, k) => `file 'seg_${String(k).padStart(3, '0')}.mp4'`).join('\n') + '\n');
  const mp4 = path.join(out, args.name || 'final.mp4'); const te = Date.now();
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', scene.audio, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', String(to - from), '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log('final mux', mp4, 'exit', r.status, ((Date.now() - te) / 1000).toFixed(1) + 's', 'total', ((Date.now() - t0) / 60000).toFixed(1) + ' min');
}
if (args.anim && fast && !args.segment) {
  const a = scene.poc.animation; const from = parseFloat(args.from ?? a.start), to = parseFloat(args.to ?? a.end), fps = 30;
  const n = Math.round((to - from) * fps); const workers = parseInt(args.workers || '1', 10);
  const mp4 = path.join(out, args.name || 'animation_fast.mp4');
  enc.proc = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', '30', '-i', '-', '-ss', String(from), '-t', String(to - from), '-i', scene.audio,
    '-map', '0:v', '-map', '1:a', '-vf', 'vflip', '-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', args.crf || '17', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=in:d=0.25,afade=t=out:st=${(to - from - 0.4).toFixed(2)}:d=0.4`, '-shortest', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const encDone = new Promise((r) => enc.proc.on('close', r));
  const stats = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const { p } = await page({ mode: 'battle' });
    for (let i = w; i < n; i += workers) {
      await p.evaluate((t) => window.ABR.frame(t), from + i / fps);
      stats[i] = await p.evaluate((i) => window.ABR.capture(i), i);
      if (i % 30 === w) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(1)}s  drawn=${stats[i]?.drawn} far=${stats[i]?.far}`);
    }
    await p.close();
  }));
  enc.proc.stdin.end(); const code = await encDone;
  console.log('encoded', mp4, code, 'render+encode', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
if (args.anim && !fast) {
  const a = scene.poc.animation; const from = parseFloat(args.from ?? a.start), to = parseFloat(args.to ?? a.end), fps = 30;
  const n = Math.round((to - from) * fps); const workers = parseInt(args.workers || '2', 10);
  const fdir = path.join(out, 'frames'); fs.mkdirSync(fdir, { recursive: true });
  const only = args.only ? parseInt(args.only, 10) : n;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const { p } = await page({ mode: 'battle' });
    for (let i = w; i < Math.min(n, only); i += workers) {
      const f = path.join(fdir, `f${String(i).padStart(5, '0')}.png`);
      if (fs.existsSync(f) && !args.force) continue;
      await p.evaluate((t) => window.ABR.frame(t), from + i / fps);
      await p.screenshot({ path: f });
      if (i % 30 === w) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await p.close();
  }));
  if (!args.noencode && only >= n) {
    const mp4 = path.join(out, args.name || 'animation_test.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '30', '-i', path.join(fdir, 'f%05d.png'), '-ss', String(from), '-t', String(to - from), '-i', scene.audio,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k',
      '-af', `afade=t=in:d=0.25,afade=t=out:st=${(to - from - 0.4).toFixed(2)}:d=0.4`, '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    console.log('encoded', mp4, r.status);
  }
}
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close(); server.close();
