// Battle simulation: formations from the episode config, block paths over the
// narration timeline, per-soldier behaviour selection, casualties, rout,
// arrows and dust. Everything is a pure function of time t, so any frame can
// be rendered independently (and in parallel) with identical results.
import * as THREE from 'three';
import { rng, hashStr } from './rng.js';
import { buildFigure } from './parts.js';
import { Rig } from './rig.js';
import { spearman, archer, rout as routPose, fall as fallPose } from './behaviours.js';
import { Crowd } from './crowd.js';

const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const fwd = (h) => [Math.sin(h), Math.cos(h)];
const right = (h) => { const [fx, fz] = fwd(h); return [-fz, fx]; };
const T0 = 0, T1 = 40, DT = 1 / 60;

function monotone(xs, ys) { // Fritsch-Carlson monotone cubic
  const n = xs.length; if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (xs[i + 1] - xs[i - 1])) / ((2 * xs[i + 1] - xs[i] - xs[i - 1]) / d[i - 1] + (xs[i + 1] + xs[i] - 2 * xs[i - 1]) / d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

class Block {
  constructor(id, u, sideKey) {
    this.id = id; this.u = u; this.side = sideKey;
    this.files = Math.floor(u.width / u.file_spacing) + 1; this.ranks = u.depth;
    this.w = (this.files - 1) * u.file_spacing;
    const h0 = (sideKey === 'greeks' ? 180 : 0) * DEG;
    const keys = []; let st = { t: T0, x: u.x, z: u.z, h: h0 };
    const path = (u.timeline.path || []).slice();
    keys.push({ ...st });
    for (const k of path) {
      const n = { ...st, t: k.t, wheel: null };
      if (k.x !== undefined) n.x = k.x; if (k.z !== undefined) n.z = k.z;
      if (k.dx) n.x += k.dx; if (k.dz) n.z += k.dz;
      if (k.heading !== undefined) n.h = k.heading * DEG;
      if (k.wheel) {
        const ends = [-this.w / 2, this.w / 2].map((uu) => { const [rx, rz] = right(st.h); return { uu, x: st.x + rx * uu, z: st.z + rz * uu }; });
        const inner = Math.abs(ends[0].x) < Math.abs(ends[1].x) ? ends[0] : ends[1];
        const [rx, rz] = right(n.h);
        n.x = inner.x - rx * inner.uu; n.z = inner.z - rz * inner.uu;
        n.wheel = { pu: inner.uu, px: inner.x, pz: inner.z, h0: st.h };
      }
      keys.push(n); st = n;
    }
    this.keys = keys;
    const ts = keys.map((k) => k.t);
    const fx = monotone(ts, keys.map((k) => k.x)), fz = monotone(ts, keys.map((k) => k.z)), fh = monotone(ts, keys.map((k) => k.h));
    this.raw = (t) => {
      for (let i = 1; i < keys.length; i++) {
        const k = keys[i];
        if (k.wheel && t > keys[i - 1].t && t < k.t) {
          const h = k.wheel.h0 + (k.h - k.wheel.h0) * S(keys[i - 1].t, k.t, t);
          const [rx, rz] = right(h);
          return { x: k.wheel.px - rx * k.wheel.pu, z: k.wheel.pz - rz * k.wheel.pu, h };
        }
      }
      return { x: fx(t), z: fz(t), h: fh(t) };
    };
  }
  sample(blocks) {
    const n = Math.ceil((T1 - T0) / DT) + 1; this.tab = new Float32Array(n * 3);
    const fol = this.u.timeline.follow;
    for (let i = 0; i < n; i++) {
      const t = T0 + i * DT; const s = this.raw(t);
      if (fol) { const L = blocks[fol.unit].at(t); s.z = s.z + (L.z - fol.gap - s.z) * S(fol.from - 0.15, fol.from + 0.25, t); }
      this.tab.set([s.x, s.z, s.h], i * 3);
    }
  }
  at(t) {
    const f = Math.min(Math.max((t - T0) / DT, 0), this.tab.length / 3 - 1.001); const i = Math.floor(f), a = f - i, o = i * 3;
    return { x: this.tab[o] * (1 - a) + this.tab[o + 3] * a, z: this.tab[o + 1] * (1 - a) + this.tab[o + 4] * a, h: this.tab[o + 2] * (1 - a) + this.tab[o + 5] * a };
  }
  slot(t, u, v) { const b = this.at(t); const [fx, fz] = fwd(b.h), [rx, rz] = right(b.h); return { x: b.x + rx * u - fx * v, z: b.z + rz * u - fz * v, h: b.h }; }
  mode(t) { let m = 'stand'; for (const e of this.u.timeline.modes || []) if (t >= e.t) m = e.mode; return m; }
  modeStart(name) { const e = (this.u.timeline.modes || []).find((x) => x.mode === name); return e ? e.t : null; }
}

export class Battle {
  constructor(scene, mats, data, opts = {}) {
    this.data = data; this.scene = scene; this.opts = opts; this.crowd = new Crowd(scene, mats, { compact: !!(opts.cull || opts.lod) }); this.rig = new Rig();
    this.blocks = {};
    for (const [id, u] of Object.entries(data.units)) this.blocks[id] = new Block(id, u, u.side);
    const order = Object.keys(this.blocks).sort((a, b) => (data.units[a].timeline.follow ? 1 : 0) - (data.units[b].timeline.follow ? 1 : 0));
    for (const id of order) this.blocks[id].sample(this.blocks);
    this.soldiers = [];
    for (const [id, b] of Object.entries(this.blocks)) this._populate(id, b);
    for (const c of data.commanders || []) this._commander(c);
    this.crowd.build();
    this._precompute();
    this._arrows(mats); this._dust();
  }

  _populate(id, b) {
    const u = b.u;
    for (let r = 0; r < b.ranks; r++) for (let fi = 0; fi < b.files; fi++) {
      const seed = hashStr(id + ':' + r + ':' + fi); const rnd = rng(seed);
      let did = u.design;
      if (!did) { did = r === 0 ? u.front : u.rear; const q = fi / (b.files - 1); if (r > 0 && u.rear_mix && q >= u.rear_mix.from && q <= u.rear_mix.to) did = u.rear_mix.design; }
      const design = this.data.designs[did];
      const fig = buildFigure(design, rnd);
      const k = { r1: rnd(), r2: rnd(), r3: rnd(), r4: rnd() };
      const s = { block: b, rank: r, file: fi, u: (fi - (b.files - 1) / 2) * u.file_spacing + rnd.range(-0.06, 0.06), v: r * u.rank_spacing + rnd.range(-0.06, 0.06),
        hj: rnd.range(-0.05, 0.05), scale: rnd.range(0.96, 1.04), design: did, role: design.role.includes('archer') ? 'archer' : 'spearman', meta: fig.meta, k, rnd };
      s.idx = this.crowd.add(fig.parts);
      this.soldiers.push(s);
    }
    // casualties
    const cas = u.timeline.casualties;
    if (cas) {
      const rnd = rng(hashStr(id + ':cas'));
      for (const s of this.soldiers.filter((x) => x.block === b && x.rank >= 0 && x.rank <= 1)) if (rnd() < cas.fraction * (s.rank === 0 ? 1.5 : 0.5)) s.tFall = rnd.range(cas.window[0], cas.window[1]);
    }
    const ro = u.timeline.rout;
    if (ro) {
      const rnd = rng(hashStr(id + ':rout')); const shore = this.data.world.shore_z;
      for (const s of this.soldiers.filter((x) => x.block === b)) {
        if (s.tFall && s.tFall < ro.start + 1.5) continue;
        delete s.tFall;
        s.tRout = ro.start + ro.spread * (rnd() * 0.6 + (1 - s.rank / b.ranks) * 0.4);
        const p0 = b.slot(s.tRout, s.u, s.v);
        const tx = p0.x * 0.55 + rnd.range(-6, 6), tz = shore + 4;
        const dx = tx - p0.x, dz = tz - p0.z, L = Math.hypot(dx, dz);
        s.rd = [dx / L, dz / L]; s.rp = p0; s.vmax = rnd.range(4.3, 5.6); s.wob = rnd.range(-0.6, 0.6);
        s.rLen = L; // stop at the shoreline by the ships
      }
    }
  }
  _commander(c) {
    const b = this.blocks[c.unit]; const rnd = rng(hashStr('cmd:' + c.id));
    const design = this.data.designs[c.design];
    const fig = buildFigure(design, rnd, {}, { crest_color: c.crest_color, crest_scale: c.crest_scale });
    const s = { block: b, rank: -1, file: -1, u: c.u, v: c.v, hj: 0, scale: 1.0, design: c.design, role: 'spearman', meta: fig.meta, k: { r1: 0.3, r2: 0.1, r3: 0.5, r4: 0.2 }, rnd, cmd: c };
    s.idx = this.crowd.add(fig.parts); this.soldiers.push(s);
  }

  // position of a soldier (ignoring falls), heading
  basePos(s, t) {
    if (s.tRout !== undefined && t >= s.tRout) {
      const dt = t - s.tRout, a = 5.5, tv = s.vmax / a;
      const d = Math.min(s.rLen ?? 1e9, dt < tv ? 0.5 * a * dt * dt : s.vmax * tv * 0.5 + s.vmax * (dt - tv));
      const wob = Math.sin(d * 0.15) * s.wob;
      const x = s.rp.x + s.rd[0] * d - s.rd[1] * wob, z = s.rp.z + s.rd[1] * d + s.rd[0] * wob;
      const hr = Math.atan2(s.rd[0], s.rd[1]);
      let dh = hr - s.rp.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      return { x, z, h: s.rp.h + dh * S(0, 0.45, dt) };
    }
    let v = s.v;
    if (s.cmd) v = s.v + (-1.25 - s.v) * S(s.cmd.command[1], s.cmd.command[1] + 4, t);
    const p = s.block.slot(t, s.u, v); p.h += s.hj;
    if (s.cmd && t < s.cmd.command[1] + 0.5) p.h += Math.PI * (1 - S(s.cmd.command[1], s.cmd.command[1] + 0.5, t));
    return p;
  }
  _precompute() {
    const n = Math.ceil((T1 - T0) / (1 / 30)) + 1;
    for (const s of this.soldiers) {
      s.dist = new Float32Array(n); let prev = this.basePos(s, T0), acc = 0;
      for (let i = 1; i < n; i++) { const p = this.basePos(s, T0 + i / 30); acc += Math.hypot(p.x - prev.x, p.z - prev.z); s.dist[i] = acc; prev = p; }
    }
  }
  distAt(s, t) { const f = Math.min(Math.max((t - T0) * 30, 0), s.dist.length - 1.001); const i = Math.floor(f); return s.dist[i] + (s.dist[i + 1] - s.dist[i]) * (f - i); }

  modeOf(s, t) {
    if (s.tRout !== undefined && t >= s.tRout) return 'rout';
    const b = s.block; const m = b.mode(t);
    if (s.cmd && t >= s.cmd.command[0] && t < s.cmd.command[1]) return 'command';
    if (s.role === 'archer') return m === 'shoot' ? 'shoot' : 'hold';
    if (s.meta.shield === 'spara') return m === 'fight' ? 'wall-fight' : 'wall-hold';
    if (m === 'fight') return s.rank <= 1 ? 'fight-front' : s.rank <= 3 ? 'fight-press' : 'fight-rear';
    return m;
  }

  poseAt(s, t) {
    const tt = s.tFall !== undefined ? Math.min(t, s.tFall) : t;
    const p = this.basePos(s, tt);
    const speed = (this.distAt(s, tt + 0.05) - this.distAt(s, tt - 0.05)) / 0.1;
    const stride = speed > 3 ? 2.3 : 1.5;
    const gait = (this.distAt(s, tt) / stride) * 2 * Math.PI + s.k.r1 * 6.28;
    const mode = this.modeOf(s, tt);
    const b = s.block;
    let lvT = b.u.timeline.spears_level ?? b.modeStart('shoot') ?? 1e9;
    const ctx = { t: tt, k: s.k, meta: s.meta, mode, speed, gait, lv: S(lvT + s.k.r4 * 0.5, lvT + s.k.r4 * 0.5 + 0.7, tt) };
    if (mode === 'shoot') { const st = b.modeStart('shoot') + s.k.r3 * 0.8; if (tt < st) ctx.mode = 'hold'; }
    let pose;
    if (mode === 'rout') pose = routPose(ctx);
    else if (s.role === 'archer') pose = archer(ctx);
    else pose = spearman(ctx);
    if (mode === 'rout' && s.meta.shield === 'spara') pose.shieldWorld = this._dropped(s, t);
    if (s.tFall !== undefined && t > s.tFall) pose = fallPose(pose, Math.min(1, (t - s.tFall) / 0.75), s.k);
    // front-rank jostle while fighting
    if ((mode === 'fight-front' || mode === 'wall-fight') && s.tFall === undefined) {
      const [fx, fz] = fwd(p.h); const j = 0.06 * Math.sin(t * 2.3 + s.k.r2 * 9);
      p.x += fx * j; p.z += fz * j;
    }
    return { p, pose };
  }
  _dropped(s, t) {
    if (!s.dropBase) { const p = this.basePos(s, s.tRout - 1e-3); const [fx, fz] = fwd(p.h); s.dropBase = { x: p.x + fx * 0.46, z: p.z + fz * 0.46, h: p.h }; }
    const a = Math.min(1, (t - s.tRout) / 0.7); const ang = 1.52 * a * a;
    const d = s.dropBase;
    return new THREE.Matrix4().makeTranslation(d.x, 0.02, d.z).multiply(new THREE.Matrix4().makeRotationY(d.h)).multiply(new THREE.Matrix4().makeRotationX(ang))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.64, 0));
  }

  // view (optional): {camera, frustum, margin, lodPx, height} enables culling / LOD
  update(t, view) {
    this.crowd.begin();
    const o = this.opts; let culled = 0, far = 0;
    const sph = new THREE.Sphere(new THREE.Vector3(), 1.9 + (view?.margin ?? 4.5));
    const k = view ? view.height / (2 * Math.tan((view.camera.fov * Math.PI) / 360)) : 0;
    for (const s of this.soldiers) {
      let lod = 0;
      if (view) {
        const q = this.basePos(s, s.tFall !== undefined ? Math.min(t, s.tFall) : t);
        sph.center.set(q.x, 1.0, q.z);
        if (o.cull && !view.frustum.intersectsSphere(sph)) { culled++; continue; }
        if (o.lod) { const d = view.camera.position.distanceTo(sph.center); if ((1.8 * k) / d < view.lodPx) { lod = 1; far++; } }
      }
      const { p, pose } = this.poseAt(s, t);
      const frames = this.rig.solve(new THREE.Vector3(p.x, 0, p.z), p.h, pose, s.scale);
      this.crowd.set(s.idx, frames, this.rig.hidden, lod);
    }
    this.crowd.commit();
    this.stats = { culled, far, drawn: this.soldiers.length - culled };
    this._updateArrows(t); this._updateDust(t);
  }

  // ------------------------------------------------------------- arrows
  _arrows(mats) {
    const list = []; const rnd = rng(77);
    const greekBlocks = Object.values(this.blocks).filter((b) => b.side === 'greeks');
    for (const s of this.soldiers) {
      if (s.role !== 'archer' || s.block.modeStart('shoot') === null) continue;
      const tS = s.block.modeStart('shoot') + s.k.r3 * 0.8, tE = s.block.u.timeline.modes.find((m) => m.mode === 'fight')?.t ?? 1e9;
      const period = 2.6 + s.k.r1 * 0.9;
      for (let n = Math.floor(tS / period) - 1; n < tE / period + 1; n++) {
        const tr = (n + 0.72 - s.k.r2) * period;
        if (tr < tS || tr > tE - 0.3) continue;
        const p = this.basePos(s, tr); const [fx, fz] = fwd(p.h);
        const o = new THREE.Vector3(p.x + fx * 0.6, 1.7, p.z + fz * 0.6);
        const gb = greekBlocks.reduce((best, b) => (Math.abs(b.at(tr).x - p.x) < Math.abs(best.at(tr).x - p.x) ? b : best));
        const flight = 1.25 + rnd() * 0.5;
        const short = rnd() < 0.55;
        const tp = gb.slot(tr + flight, rnd.range(-gb.w / 2, gb.w / 2), short ? -rnd.range(0.8, 7) : rnd.range(0, gb.ranks * 1.0));
        const e = new THREE.Vector3(tp.x + rnd.range(-0.4, 0.4), 0.0, tp.z);
        const g = -9.8; const v0 = e.clone().sub(o).divideScalar(flight); v0.y -= 0.5 * g * flight;
        list.push({ t0: tr, T: flight, o, v0, g, stick: short });
      }
    }
    this.arrowList = list;
    const geo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4).translate(0, 0.4, 0);
    const head = new THREE.ConeGeometry(0.025, 0.07, 4).translate(0, 0.83, 0);
    const fl = new THREE.BoxGeometry(0.05, 0.12, 0.004).translate(0, 0.07, 0);
    const mk = (g, col) => { const m = new THREE.InstancedMesh(g, mats.wood, Math.max(1, list.length)); m.frustumCulled = false; m.castShadow = true; const c = new THREE.Color(col); for (let i = 0; i < list.length; i++) m.setColorAt(i, c); this.scene.add(m); return m; };
    this.arrowMeshes = [mk(geo, '#b89a6a'), mk(head, '#5a5650'), mk(fl, '#e8e0d0')];
  }
  _updateArrows(t) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Matrix4().makeScale(0, 0, 0), one = new THREE.Vector3(1, 1, 1);
    this.arrowList.forEach((a, i) => {
      const dt = t - a.t0; let M = Z;
      if (dt >= 0 && (dt <= a.T || a.stick)) {
        const tt = Math.min(dt, a.T);
        const pos = a.o.clone().addScaledVector(a.v0, tt); pos.y += 0.5 * a.g * tt * tt;
        const vel = a.v0.clone(); vel.y += a.g * tt;
        if (dt > a.T) pos.addScaledVector(vel.clone().normalize(), 0.3); // embedded in the ground
        q.setFromUnitVectors(UP, vel.normalize());
        M = m.compose(pos.addScaledVector(vel, -0.8), q, one);
      }
      for (const mesh of this.arrowMeshes) mesh.setMatrixAt(i, M);
    });
    for (const mesh of this.arrowMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------- dust
  _dust() {
    const P = []; const rnd = rng(99);
    const add = (t, x, z, size, life, vy, spread) => P.push({ t, x, z, size, life, vy, vx: rnd.range(-spread, spread), vz: rnd.range(-spread, spread) });
    for (const b of Object.values(this.blocks)) {
      const runT = b.modeStart('run'), fightT = b.modeStart('fight');
      if (runT !== null) for (let t = runT; t < fightT + 0.5; t += 0.03) { const p = b.slot(t, rnd.range(-b.w / 2, b.w / 2), rnd.range(0, b.ranks)); add(t, p.x, p.z, rnd.range(1.2, 2.6), rnd.range(1.8, 3.2), rnd.range(0.2, 0.6), 0.5); }
      if (fightT !== null && b.side === 'greeks') for (let t = fightT - 0.1; t < fightT + 9; t += 0.035) { const p = b.slot(t, rnd.range(-b.w / 2, b.w / 2), rnd.range(-1.2, 0.8)); add(t, p.x, p.z, rnd.range(1.8, 4.2), rnd.range(2.5, 4.5), rnd.range(0.25, 0.7), 0.6); }
    }
    for (const s of this.soldiers) if (s.tRout !== undefined && rnd() < 0.5) for (let k = 0; k < 3; k++) { const t = s.tRout + 0.4 + k * 0.7 + rnd() * 0.3; const p = this.basePos(s, t); add(t, p.x, p.z, rnd.range(1.2, 2.4), rnd.range(1.5, 2.6), 0.3, 0.4); }
    this.dustList = P;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.length * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(P.length), 1));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(P.length), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1000 }, color: { value: new THREE.Color('#d2bd96') }, fogColor: { value: new THREE.Color('#d9c9a8') } },
      vertexShader: `attribute float alpha; attribute float size; uniform float scale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = min(600.0, size*scale/-mv.z); vA = alpha; }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float r = dot(d,d)*4.0; float a = vA*smoothstep(1.0,0.0,r)*smoothstep(1.0,0.35,r); if(a<0.004) discard; gl_FragColor = vec4(color, a); }`,
      transparent: true, depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat); this.dust.frustumCulled = false; this.scene.add(this.dust);
  }
  _updateDust(t) {
    const pos = this.dust.geometry.attributes.position, al = this.dust.geometry.attributes.alpha, sz = this.dust.geometry.attributes.size;
    this.dustList.forEach((d, i) => {
      const a = (t - d.t) / d.life;
      if (a < 0 || a > 1) { al.array[i] = 0; return; }
      const age = t - d.t;
      pos.array.set([d.x + d.vx * age, 0.4 + d.vy * age, d.z + d.vz * age], i * 3);
      sz.array[i] = d.size * (0.6 + 1.6 * a); al.array[i] = 0.28 * Math.sin(Math.PI * Math.min(1, a * 1.3)) * (1 - a);
    });
    pos.needsUpdate = al.needsUpdate = sz.needsUpdate = true;
  }
}
