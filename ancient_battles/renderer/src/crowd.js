// Instanced drawing of many rigged figures: one InstancedMesh per part key.
//
// legacy mode : every soldier owns fixed instance slots (hidden = zero matrix).
// compact mode: visible soldiers are packed into the front of each InstancedMesh
//               every frame and mesh.count is set, so culled soldiers cost no
//               vertex work at all (main pass AND shadow pass). Distant soldiers
//               use LOD-1 geometry (half the segments, minor details dropped).
import * as THREE from 'three';
import { geometry, MINOR, NO_SHADOW } from './parts.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export class Crowd {
  constructor(scene, materials, opts = {}) { this.scene = scene; this.mats = materials; this.figs = []; this.groups = new Map(); this.compact = !!opts.compact; }
  _group(key, mat, lod) {
    const gk = key + '|' + mat + '|' + lod;
    if (!this.groups.has(gk)) this.groups.set(gk, { key, mat, lod, items: [], n: 0 });
    return this.groups.get(gk);
  }
  add(parts) {
    const idx = this.figs.length; const slots = [];
    for (const p of parts) {
      const color = new THREE.Color(p.color);
      const g0 = this._group(p.key, p.mat, 0); const s = { p, color, g0, i: g0.items.length }; g0.items.push(p.color);
      if (this.compact && !MINOR.has(p.key)) { s.g1 = this._group(p.key, p.mat, 1); s.g1.items.push(p.color); }
      slots.push(s);
    }
    this.figs.push(slots); return idx;
  }
  build() {
    const c = new THREE.Color();
    for (const g of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(geometry(g.key, g.lod), this.mats[g.mat], g.items.length);
      mesh.castShadow = !(this.compact && NO_SHADOW.has(g.key)); mesh.receiveShadow = true; mesh.frustumCulled = false;
      g.items.forEach((col, i) => { mesh.setColorAt(i, c.set(col)); mesh.setMatrixAt(i, ZERO); });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.compact) { mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; }
      g.mesh = mesh; this.scene.add(mesh);
    }
  }
  begin() { if (this.compact) for (const g of this.groups.values()) g.n = 0; }
  set(idx, frames, hidden, lod = 0) {
    const m = new THREE.Matrix4();
    if (this.compact) {
      for (const s of this.figs[idx]) {
        const g = lod ? s.g1 : s.g0; if (!g || (hidden && hidden.has(s.p.frame))) continue;
        m.multiplyMatrices(frames[s.p.frame], s.p.local); g.mesh.setMatrixAt(g.n, m); g.mesh.setColorAt(g.n, s.color); g.n++;
      }
      return;
    }
    for (const s of this.figs[idx]) {
      if (hidden && hidden.has(s.p.frame)) { s.g0.mesh.setMatrixAt(s.i, ZERO); continue; }
      m.multiplyMatrices(frames[s.p.frame], s.p.local); s.g0.mesh.setMatrixAt(s.i, m);
    }
  }
  hide(idx) { if (!this.compact) for (const s of this.figs[idx]) s.g0.mesh.setMatrixAt(s.i, ZERO); }
  commit() {
    for (const g of this.groups.values()) {
      if (this.compact) { g.mesh.count = g.n; g.mesh.visible = g.n > 0; if (g.n) { g.mesh.instanceColor.needsUpdate = true; g.mesh.instanceMatrix.addUpdateRange(0, g.n * 16); } }
      g.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
