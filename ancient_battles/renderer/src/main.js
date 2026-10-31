// Entry point used by render.mjs (headless) or a browser for previews.
// window.ABR.init({...}) then window.ABR.frame(t) per frame.
import * as THREE from 'three';
import { materials, buildWorld, canvasTex } from './world.js';
import { Battle } from './battle.js';
import { buildFigure } from './parts.js';
import { Crowd } from './crowd.js';
import { Rig } from './rig.js';
import { spearman, archer } from './behaviours.js';
import { rng } from './rng.js';
import { makePost } from './post.js';
import { makeFastPost, drawOverlay } from './fastpost.js';

const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return 0.5 - 0.5 * Math.cos(Math.PI * t); };
const $ = (id) => document.getElementById(id);

const ABR = {};
window.ABR = ABR;

ABR.init = async ({ scene: url, mode = 'battle', showcase, width = 1080, height = 1920, samples = 4, shadow = 4096,
  // optimisation switches (defaults = original pipeline)
  fast = false, iscale = 1, cull = false, lod = false, lodPx = 70, shadowType = 'pcfsoft', margin = 4.5 }) => {
  const data = await (await fetch(url)).json();
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = shadowType === 'pcf' ? THREE.PCFShadowMap : shadowType === 'basic' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  $('wrap').style.width = width + 'px'; $('wrap').style.height = height + 'px';
  $('wrap').prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 2000);
  const mats = materials();
  Object.assign(ABR, { data, renderer, scene, camera, mats, width, height, mode, fast, lodPx, margin });
  if (fast) { ABR.post = makeFastPost(renderer, scene, camera, { w: width, h: height }, { w: Math.round(width * iscale), h: Math.round(height * iscale) }, samples); document.querySelectorAll('.ov').forEach((e) => (e.style.display = 'none')); }
  else ABR.post = makePost(renderer, scene, camera, width, height, samples);
  if (mode === 'battle') {
    ABR.world = buildWorld(scene, renderer, data.world, mats); ABR.world.sun.shadow.mapSize.set(shadow, shadow);
    ABR.battle = new Battle(scene, mats, data, { cull, lod });
    $('chip').innerHTML = `<div class="k">${data.label}</div><div class="t">${data.battle.name} · ${data.year_label}</div>`;
  } else initShowcase(data, showcase);
  return { soldiers: ABR.battle ? ABR.battle.soldiers.length : 0, arrows: ABR.battle ? ABR.battle.arrowList.length : 0 };
};

// ---------------------------------------------------------------- cameras
function anchorPoint(a, t, p) {
  if (a === 'world') return new THREE.Vector3(p.x, p.y, p.z);
  const s = ABR.battle.blocks[a].slot(t, p.u, p.v); return new THREE.Vector3(s.x, p.y, s.z);
}
function shotCamera(sh, t) {
  const e = sh.start === undefined ? 0 : ease(sh.start, sh.end, t);
  const lerpP = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * e]));
  const cp = sh.cam ? sh.cam : lerpP(sh.cam_from, sh.cam_to), lp = sh.look ? sh.look : lerpP(sh.look_from, sh.look_to);
  const pos = anchorPoint(sh.anchor, t, cp), look = anchorPoint(sh.anchor, t, lp);
  ABR.camera.position.copy(pos); ABR.camera.fov = sh.fov; ABR.camera.updateProjectionMatrix(); ABR.camera.lookAt(look);
  return { pos, look };
}
function fitShadow(look, pos) {
  const { sun, sunDir } = ABR.world; const d = pos.distanceTo(look);
  const ext = Math.min(75, Math.max(7, d * 0.85));
  sun.target.position.copy(look); sun.position.copy(look).addScaledVector(sunDir, 160);
  const c = sun.shadow.camera; c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = 400; c.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
}

// ---------------------------------------------------------------- captions
function captionWords(t) {
  if (!ABR._chunks) {
    const chunks = []; let cur = [];
    for (const w of ABR.data.captions) { cur.push(w); if (cur.length >= 4 || /[.,;!?]$/.test(w.w)) { chunks.push(cur); cur = []; } }
    if (cur.length) chunks.push(cur); ABR._chunks = chunks;
  }
  const ch = ABR._chunks.find((c) => t >= c[0].s - 0.05 && t < c[c.length - 1].e + 0.25);
  return ch ? ch.map((w) => ({ w: w.w, on: t >= w.s - 0.03 })) : [];
}
function captions(t) {
  $('cap').innerHTML = captionWords(t).map((w) => `<span class="${w.on ? 'on' : ''}">${w.w}</span>`).join(' ');
}
// Read the finished frame (output resolution, bottom-up RGBA) and hand it to the local encoder.
ABR.capture = async (i) => {
  const gl = ABR.renderer.getContext(); const W = ABR.width, H = ABR.height;
  if (!ABR._px) ABR._px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ABR._px);
  await fetch('/frame/' + i, { method: 'POST', body: ABR._px });
  return ABR.battle ? ABR.battle.stats : null;
};

ABR.frame = (t, opts = {}) => {
  const { data } = ABR; let sh = opts.shot;
  if (!sh) sh = data.poc.shots.find((s) => t >= s.start && t < s.end) || data.poc.shots[data.poc.shots.length - 1];
  const { pos, look } = shotCamera(sh, t);
  if (ABR.battle.opts.cull || ABR.battle.opts.lod) {
    ABR.camera.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(ABR.camera.projectionMatrix, ABR.camera.matrixWorldInverse));
    ABR.battle.update(t, { camera: ABR.camera, frustum: fr, margin: ABR.margin, lodPx: ABR.lodPx, height: ABR.height });
  } else ABR.battle.update(t);
  fitShadow(look, pos);
  if (ABR.fast) {
    const notes = sh.notes && sh.notes.length ? 'Reconstruction: ' + sh.notes.join(' · ') : '';
    const words = opts.captions === false ? [] : captionWords(t);
    const sig = notes + '|' + words.map((w) => w.w + (w.on ? '*' : '')).join(' ');
    if (sig !== ABR._ovSig) { drawOverlay(ABR.post.overlay, { chip: data.label, title: `${data.battle.name} · ${data.year_label}`, notes, words }); ABR.post.ovTex.needsUpdate = true; ABR._ovSig = sig; }
    ABR.post.set({ focus: sh.focus ?? 0.5, blur: sh.blur ?? 1, frame: Math.round(t * 30) });
    ABR.post.render();
    return sh.id;
  }
  ABR.post.set({ focus: sh.focus ?? 0.5, blur: sh.blur ?? 1, frame: Math.round(t * 30) });
  $('notes').textContent = sh.notes && sh.notes.length ? 'Reconstruction: ' + sh.notes.join(' · ') : '';
  if (opts.captions !== false) captions(t); else $('cap').innerHTML = '';
  ABR.post.composer.render();
  return sh.id;
};

// ---------------------------------------------------------------- showcase (style sheet)
function initShowcase(data, id) {
  const sc = data.poc.showcase.find((s) => s.id === id);
  const { scene, renderer, camera, mats } = ABR;
  scene.background = canvasTex(4, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#efe6d2'); gr.addColorStop(0.6, '#d9c9a8'); gr.addColorStop(1, '#b59e74'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  scene.background.wrapS = scene.background.wrapT = THREE.ClampToEdgeWrapping;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene(); env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: '#f0e3c8', side: THREE.BackSide })));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' })); panel.position.set(3, 5, 4); panel.lookAt(0, 0, 0); env.add(panel);
  scene.environment = pm.fromScene(env, 0.03).texture; scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight('#fff6e6', '#7a6a50', 0.9));
  const key = new THREE.DirectionalLight('#ffe6c0', 3.0); key.position.set(4, 7, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); key.shadow.bias = -0.0003; scene.add(key);
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.6); rim.position.set(-5, 4, -6); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 })); floor.receiveShadow = true; scene.add(floor);
  const crowd = new Crowd(scene, mats); const rig = new Rig(); const figs = [];
  const baseGeo = new THREE.CylinderGeometry(0.46, 0.5, 0.08, 40);
  const baseMat = new THREE.MeshStandardMaterial({ color: '#7a6a48', roughness: 0.95 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#a48f5c', roughness: 1 });
  const rnd = rng(9);
  for (const f of sc.figures) {
    const design = data.designs[f.design]; const fig = buildFigure(design, rng(f.seed), f.variant || {});
    figs.push({ f, design, meta: fig.meta, idx: crowd.add(fig.parts), items: fig.meta.items });
    const b = new THREE.Mesh(baseGeo, baseMat); b.position.set(f.u, -0.04, 0); b.receiveShadow = b.castShadow = true; scene.add(b);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.455, 40).rotateX(-Math.PI / 2), topMat); top.position.set(f.u, 0.001, 0); top.receiveShadow = true; scene.add(top);
    for (let i = 0; i < 14; i++) { const tf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5), new THREE.MeshStandardMaterial({ color: rnd.pick(['#86804a', '#9b8a52', '#6f7a3e']) })); const a = rnd() * 6.28, r = 0.2 + rnd() * 0.22; tf.position.set(f.u + Math.cos(a) * r, 0.04, Math.sin(a) * r); scene.add(tf); }
  }
  crowd.build();
  ABR.showcase = { sc, crowd, rig, figs };
  const n = sc.figures.length;
  camera.fov = 30; camera.position.set(0, 1.45, n > 2 ? 11.2 : 8.2); camera.lookAt(0, 0.95, 0); camera.updateProjectionMatrix();
  $('chip').innerHTML = `<div class="k">${data.label} · STYLE STUDY</div><div class="t">${data.battle.name} · ${data.year_label}</div>`;
  ABR.frame = (t) => {
    for (const g of figs) {
      const k = { r1: 0.2, r2: 0.3, r3: 0.4, r4: 0.1 };
      const mode = { march: 'pose-march', fight: 'fight-front', 'hold-wall': 'wall-hold', draw: 'pose-draw', stand: 'hold' }[g.f.pose];
      const ctx = { t, k, meta: g.meta, mode, speed: 0, gait: 0, lv: g.f.pose === 'march' ? 0 : 1 };
      const pose = g.design.role.includes('archer') ? archer(ctx) : spearman(ctx);
      if (g.f.pose === 'fight') { pose.lThigh = -0.4; pose.lKnee = 0.3; pose.rThigh = 0.3; pose.rKnee = 0.2; pose.bob = -0.04; }
      const frames = rig.solve(new THREE.Vector3(g.f.u, 0, 0), g.f.heading * Math.PI / 180, pose, 1);
      crowd.set(g.idx, frames, rig.hidden);
    }
    crowd.commit();
    ABR.post.set({ focus: 0.5, blur: 0.0, frame: 1, vig: 0.22 });
    ABR.post.composer.render();
    // name plates under each base
    document.querySelectorAll('.plate').forEach((e) => e.remove());
    for (const g of figs) {
      const p = new THREE.Vector3(g.f.u, -0.1, 0.5).project(camera);
      const x = (p.x * 0.5 + 0.5) * ABR.width, y = (-p.y * 0.5 + 0.5) * ABR.height;
      const div = document.createElement('div'); div.className = 'plate'; div.style.left = x + 'px'; div.style.top = y + 30 + 'px'; div.style.width = Math.min(420, 980 / n) + 'px';
      const kit = g.design.kit.flatMap((e) => (e.choice ? e.choice : [e])).filter((e) => g.items.includes(e.item));
      div.innerHTML = `<div class="n">${g.design.label.split(' (')[0]}</div><div class="d">${kit.map((e) => (e.evidence !== 'attested' ? `<span class="r">${e.name.split(' (')[0]}*</span>` : e.name.split(' (')[0])).join('<br>')}</div>`;
      $('wrap').appendChild(div);
    }
    return sc.id;
  };
}
