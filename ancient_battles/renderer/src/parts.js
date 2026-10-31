// Geometry factories for the miniature-figurine look, and the mapping from
// library equipment ("render.part") to concrete figure parts.
//
// A figure is a list of parts {key, mat, frame, local(Matrix4), color}.
// Parts with the same key are drawn as ONE InstancedMesh, so a battle with
// a thousand soldiers costs a few dozen draw calls.
import * as THREE from 'three';

const M4 = (pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));

// ------------------------------------------------------------------ geometry
const G = {};
// Q = segment quality; LOD 1 (distant soldiers) builds the same shapes with ~half the segments.
let Q = 1;
const sg = (n, min = 3) => Math.max(min, Math.round(n * Q));
const lathe = (pts, seg = 16) => {
  seg = sg(seg, 6);
  // LatheGeometry faces outward only when the profile runs upward; flip downward profiles.
  const p = pts[0][1] > pts[pts.length - 1][1] ? pts.slice().reverse() : pts;
  return new THREE.LatheGeometry(p.map(([x, y]) => new THREE.Vector2(x, y)), seg);
};
function along(geo, len) { geo.translate(0, -len / 2, 0); return geo; } // hang from joint, along -y

export const GEOMETRY = {
  // body (rig: shoulder at chest+0.36, upper arm 0.29, forearm 0.27, thigh/shin 0.44)
  'body.head': () => { const g = new THREE.SphereGeometry(0.128, sg(12, 6), sg(9, 5)); g.scale(0.95, 1.08, 1.0); return g; },
  'body.neck': () => new THREE.CylinderGeometry(0.055, 0.06, 0.12, sg(10, 5)).translate(0, 0.44, 0),
  'body.torso': () => lathe([[0, -0.02], [0.15, 0.0], [0.165, 0.12], [0.2, 0.28], [0.215, 0.36], [0.16, 0.42], [0.06, 0.45], [0, 0.45]], 14),
  'body.hips': () => { const g = new THREE.SphereGeometry(0.16, sg(10, 6), sg(6, 4)); g.scale(1.05, 0.75, 0.85); return g; },
  'body.upperarm': () => along(new THREE.CylinderGeometry(0.052, 0.046, 0.29, sg(10, 5)), 0.29),
  'body.forearm': () => along(new THREE.CylinderGeometry(0.045, 0.038, 0.27, sg(10, 5)), 0.27),
  'body.hand': () => new THREE.SphereGeometry(0.04, 7, 5).translate(0, -0.285, 0),
  'body.thigh': () => along(new THREE.CylinderGeometry(0.075, 0.062, 0.44, sg(10, 5)), 0.44),
  'body.shin': () => along(new THREE.CylinderGeometry(0.058, 0.045, 0.44, sg(10, 5)), 0.44),
  'body.foot': () => new THREE.BoxGeometry(0.09, 0.05, 0.2).translate(0, -0.455, 0.04),
  'body.beard': () => { const g = new THREE.SphereGeometry(0.06, 8, 5); g.scale(1.15, 0.9, 0.7); return g.translate(0, -0.105, 0.075); },
  'body.eyes': () => { const a = new THREE.SphereGeometry(0.016, 4, 3).translate(0.042, 0.02, 0.115); const b = a.clone().translate(-0.084, 0, 0); return mergeGeos([a, b]); },

  // garments
  'garment.skirt-short': () => lathe([[0.16, 0.06], [0.2, -0.06], [0.245, -0.2], [0.25, -0.22]], 16).translate(0, 0, 0),
  'garment.skirt-long': () => lathe([[0.16, 0.06], [0.21, -0.1], [0.26, -0.36], [0.265, -0.4]], 16),
  'garment.sleeve-short': () => along(new THREE.CylinderGeometry(0.066, 0.064, 0.13, sg(10, 5)), 0.13),
  'garment.belt': () => new THREE.TorusGeometry(0.17, 0.022, 4, 14).rotateX(Math.PI / 2).translate(0, 0.03, 0),

  // armour
  'cuirass.shell': () => lathe([[0, 0.0], [0.178, 0.0], [0.19, 0.1], [0.222, 0.27], [0.23, 0.35], [0.19, 0.4], [0.09, 0.43], [0, 0.43]], 16).translate(0, 0.0, 0.004),
  'cuirass.trim': () => new THREE.TorusGeometry(0.182, 0.018, 4, 14).rotateX(Math.PI / 2).translate(0, 0.005, 0),
  'cuirass.shoulders': () => { const a = new THREE.BoxGeometry(0.12, 0.03, 0.22).translate(0.13, 0.43, 0); const b = a.clone().translate(-0.26, 0, 0); return mergeGeos([a, b]); },
  'cuirass.pteruges': () => { // ring of flaps
    const geos = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const g = new THREE.BoxGeometry(0.07, 0.15, 0.015); g.rotateX(-0.12); g.translate(0, -0.075, 0.19); g.rotateY(a); geos.push(g); }
    return mergeGeos(geos);
  },
  'greave': () => along(new THREE.CylinderGeometry(0.066, 0.056, 0.34, sg(10, 5), 1, true), 0.34).translate(0, -0.06, 0.004),

  // headgear
  'helmet.corinthian': () => lathe([[0, 0.17], [0.07, 0.165], [0.13, 0.13], [0.158, 0.06], [0.16, -0.04], [0.152, -0.13], [0.17, -0.185], [0.175, -0.19]], 18),
  'helmet.slits': () => { const a = new THREE.BoxGeometry(0.2, 0.034, 0.05).translate(0, 0.02, 0.145); const b = new THREE.BoxGeometry(0.055, 0.15, 0.05).translate(0, -0.07, 0.147); return mergeGeos([a, b]); },
  'helmet.crest': () => {
    const s = new THREE.Shape(); s.moveTo(-0.2, 0); s.quadraticCurveTo(-0.2, 0.17, 0.0, 0.18); s.quadraticCurveTo(0.2, 0.18, 0.22, 0.0); s.quadraticCurveTo(0.2, -0.12, 0.09, -0.2);
    s.lineTo(0.06, -0.12); s.quadraticCurveTo(0.1, 0.02, 0, 0.02); s.lineTo(-0.2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: sg(5, 3) });
    g.translate(0, 0, -0.025); g.rotateY(-Math.PI / 2); return g.translate(0, 0.215, 0);
  },
  'helmet.crest-holder': () => new THREE.CylinderGeometry(0.018, 0.024, 0.06, 8).translate(0, 0.19, 0),
  'cap.felt-dome': () => { const g = new THREE.SphereGeometry(0.15, sg(12, 6), sg(6, 4), 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(1, 1.15, 1.02); return g.translate(0, 0.02, -0.01); },
  'cap.flaps': () => new THREE.CylinderGeometry(0.152, 0.17, 0.24, sg(16, 6), 1, true, Math.PI * 0.30, Math.PI * 1.4).translate(0, -0.08, -0.01),
  'cap.saka-cone': () => { const g = new THREE.ConeGeometry(0.15, 0.38, sg(16, 6), 1, true); g.translate(0, 0.25, 0); g.rotateX(-0.32); return g; },

  // shields (frame: +z is the outer face)
  'shield.aspis-face': () => lathe([[0, 0.1], [0.2, 0.088], [0.34, 0.05], [0.41, 0.012], [0.415, 0.0]], 28).rotateX(Math.PI / 2),
  'shield.aspis-rim': () => new THREE.TorusGeometry(0.43, 0.03, sg(5, 3), sg(28, 12)).scale(1, 1, 0.6),
  'shield.spara': () => { const g = new THREE.BoxGeometry(0.64, 1.28, 0.035, 1, 6, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) - 0.12 * x * x); } g.computeVertexNormals(); return g; },
  'shield.spara-frame': () => { const t = 0.03, w = 0.66, h = 1.3; const parts = [new THREE.BoxGeometry(w, t, 0.05).translate(0, h / 2, 0), new THREE.BoxGeometry(w, t, 0.05).translate(0, -h / 2, 0), new THREE.BoxGeometry(t, h, 0.05).translate(w / 2, 0, -0.05), new THREE.BoxGeometry(t, h, 0.05).translate(-w / 2, 0, -0.05)]; return mergeGeos(parts); },

  // devices on the aspis (generic, illustrative)
  'device.wheel': () => deviceGeo((s) => { ring(s, 0.2, 0.15); }, (g) => { for (let i = 0; i < 4; i++) g.push(new THREE.BoxGeometry(0.03, 0.31, 0.02).rotateZ(i * Math.PI / 4)); }),
  'device.club': () => deviceGeo((s) => { s.moveTo(-0.03, -0.24); s.lineTo(0.03, -0.24); s.quadraticCurveTo(0.09, 0.15, 0.06, 0.24); s.quadraticCurveTo(0, 0.29, -0.06, 0.24); s.quadraticCurveTo(-0.09, 0.15, -0.03, -0.24); }),
  'device.crescent': () => deviceGeo((s) => { s.absarc(0, 0, 0.2, Math.PI * 0.15, Math.PI * 1.85, false); s.absarc(0.07, 0, 0.16, Math.PI * 1.8, Math.PI * 0.2, true); }),
  'device.snake': () => { const pts = []; for (let i = 0; i <= 24; i++) { const y = -0.24 + i * 0.02; pts.push(new THREE.Vector3(Math.sin(i * 0.55) * 0.08, y, 0)); } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.022, 6).translate(0, 0, 0.105); },

  // weapons (spear frame: origin at the grip, +y toward the point)
  'weapon.shaft': () => new THREE.CylinderGeometry(0.016, 0.016, 1, 6).translate(0, 0.5, 0), // scaled per length
  'weapon.spearhead': () => lathe([[0, 0], [0.03, 0.06], [0.034, 0.12], [0.018, 0.22], [0, 0.27]], 6).scale(1, 1, 0.45),
  'weapon.sauroter': () => new THREE.ConeGeometry(0.022, 0.16, 6).rotateX(Math.PI),
  'weapon.scabbard': () => new THREE.CylinderGeometry(0.03, 0.02, 0.42, 6).rotateZ(0.25).rotateX(-0.6).translate(0.2, -0.05, 0.04),
  'weapon.dagger': () => new THREE.BoxGeometry(0.05, 0.3, 0.03).rotateZ(-0.12).translate(-0.19, -0.12, 0.07),
  'weapon.axe': () => mergeGeos([new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6).translate(0.19, -0.08, -0.08), new THREE.BoxGeometry(0.03, 0.06, 0.14).translate(0.19, 0.14, -0.1)]),
  'weapon.bow': () => {
    const pts = [[0, -0.56, -0.06], [0, -0.5, -0.12], [0, -0.32, -0.15], [0, -0.12, -0.04], [0, 0, 0], [0, 0.12, -0.04], [0, 0.32, -0.15], [0, 0.5, -0.12], [0, 0.56, -0.06]].map((p) => new THREE.Vector3(...p));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), sg(18, 8), 0.016, sg(4, 3));
  },
  'segment.string': () => new THREE.CylinderGeometry(0.004, 0.004, 1, 4).translate(0, 0.5, 0),
  'segment.arrow': () => mergeGeos([new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, 0.5, 0), new THREE.ConeGeometry(0.018, 0.06, 4).translate(0, 1.0, 0)]),
  'gear.quiver': () => mergeGeos([new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8).rotateX(0.25).rotateZ(-0.35).translate(-0.05, 0.25, -0.2)]),
  'gear.quiver-arrows': () => mergeGeos([new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8).rotateX(0.25).rotateZ(-0.35).translate(-0.15, 0.55, -0.27)]),
};

function ring(s, r0, r1) { s.absarc(0, 0, r0, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, r1, 0, Math.PI * 2, true); s.holes.push(h); }
function deviceGeo(draw, extra) {
  const s = new THREE.Shape(); draw(s);
  const geos = [new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 12 })];
  if (extra) { const e = []; extra(e); geos.push(...e); }
  return mergeGeos(geos).translate(0, 0, 0.098);
}
export function mergeGeos(geos) {
  // minimal merge (positions + normals + uv), avoids pulling extra addons
  const ng = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of ng) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of ng) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
export function geometry(key, lod = 0) {
  const ck = key + '#' + lod;
  if (!G[ck]) { const f = GEOMETRY[key]; if (!f) throw new Error('no geometry ' + key); Q = lod ? 0.5 : 1; G[ck] = f(); Q = 1; G[ck].computeBoundingSphere(); }
  return G[ck];
}
// Small details dropped for distant (LOD 1) soldiers; they are a few pixels tall there.
export const MINOR = new Set(['body.eyes', 'body.hand', 'body.neck', 'body.foot', 'garment.belt', 'garment.sleeve-short', 'cuirass.trim', 'cuirass.shoulders',
  'helmet.crest-holder', 'weapon.scabbard', 'weapon.dagger', 'weapon.axe', 'weapon.sauroter', 'gear.quiver-arrows', 'segment.string']);
// Parts too small to cast a visible shadow.
export const NO_SHADOW = new Set(['body.eyes', 'body.hand', 'body.beard', 'helmet.slits', 'helmet.crest-holder', 'cuirass.trim', 'garment.belt', 'segment.string',
  'weapon.scabbard', 'weapon.dagger', 'gear.quiver-arrows', 'device.wheel', 'device.club', 'device.crescent', 'device.snake']);

// ------------------------------------------------------------------ figure assembly
const I = M4();
const P = (key, mat, frame, color, local = I) => ({ key, mat, frame, color, local });

// Build the part list for one soldier. `rnd` is that soldier's seeded RNG;
// `variant` can force choices (showcase) e.g. {cuirass: 'bronze-cuirass'}.
export function buildFigure(design, rnd, variant = {}, extra = {}) {
  const parts = [];
  const skin = rnd.pick(design.body.skin || ['#c4936a']);
  const beard = design.body.beard ? rnd.pick(design.body.beard) : null;
  const look = { torso: skin, arms: skin, forearms: skin, legs: skin, skirt: null, sleeves: null };
  const kit = [];
  for (const e of design.kit) {
    if (e.choice) {
      const forced = variant.cuirass && e.choice.find((c) => c.item === variant.cuirass);
      kit.push(forced || rnd.weighted(e.choice));
    } else kit.push(e);
  }
  const has = (part) => kit.find((k) => k.render.part === part);
  const meta = { items: kit.map((k) => k.item), spearLength: 0, shield: null, bow: false };

  // clothing first (sets limb colours)
  const tunic = has('garment.short-tunic');
  if (tunic) { const c = rnd.pick(tunic.colors); look.torso = c; look.skirt = ['garment.skirt-short', c]; look.sleeves = c; }
  const sleeved = has('garment.sleeved-tunic');
  if (sleeved) { const c = rnd.pick(sleeved.colors); look.torso = c; look.arms = c; look.forearms = c; look.skirt = ['garment.skirt-long', c]; }
  const trousers = has('garment.trousers');
  if (trousers) look.legs = rnd.pick(trousers.colors);

  // body
  parts.push(P('body.head', 'skin', 'head', skin), P('body.neck', 'skin', 'chest', skin), P('body.torso', 'cloth', 'chest', look.torso),
    P('body.hips', 'cloth', 'pelvis', look.skirt ? look.skirt[1] : look.legs));
  for (const s of ['l', 'r']) {
    parts.push(P('body.upperarm', 'cloth', s + 'Upper', look.arms), P('body.forearm', 'cloth', s + 'Fore', look.forearms), P('body.hand', 'skin', s + 'Fore', skin),
      P('body.thigh', 'cloth', s + 'Thigh', look.legs), P('body.shin', 'cloth', s + 'Shin', look.legs), P('body.foot', 'leather', s + 'Shin', '#4a3424'));
    if (look.sleeves) parts.push(P('garment.sleeve-short', 'cloth', s + 'Upper', look.sleeves));
  }
  if (look.skirt) parts.push(P(look.skirt[0], 'cloth', 'pelvis', look.skirt[1]));
  if (sleeved) parts.push(P('garment.belt', 'leather', 'pelvis', '#3b2a1c'));
  if (beard) parts.push(P('body.beard', 'hair', 'head', beard));

  // armour
  const lino = has('cuirass.linothorax');
  if (lino) {
    const c = rnd.pick(lino.colors || ['#ece3cc']);
    parts.push(P('cuirass.shell', 'linen', 'chest', c), P('cuirass.shoulders', 'linen', 'chest', c), P('cuirass.trim', 'cloth', 'chest', rnd.pick(lino.trim || ['#9b2e22'])),
      P('cuirass.pteruges', 'linen', 'pelvis', c));
  }
  if (has('cuirass.bronze')) parts.push(P('cuirass.shell', 'bronze', 'chest', bronze(rnd)), P('cuirass.pteruges', 'linen', 'pelvis', '#e2d6b8'));
  if (has('cuirass.scale')) parts.push(P('cuirass.shell', 'scale', 'chest', '#8d8a80'));
  if (has('greaves.bronze')) for (const s of ['l', 'r']) parts.push(P('greave', 'bronze', s + 'Shin', bronze(rnd)));

  // headgear
  const helm = has('helmet.corinthian');
  if (helm) {
    const crest = extra.crest_color || rnd.pick(helm.crest_colors || ['#1c1714']);
    const cs = extra.crest_scale || 1;
    parts.push(P('helmet.corinthian', 'bronze', 'head', bronze(rnd)), P('helmet.slits', 'dark', 'head', '#100c0a'), P('helmet.crest-holder', 'bronze', 'head', '#a87a3c'),
      P('helmet.crest', 'hair', 'head', crest, M4([0, 0.2 * (cs - 1), 0], [0, 0, 0], [1, cs, cs])));
  } else {
    parts.push(P('body.eyes', 'dark', 'head', '#120d0a'));
  }
  const felt = has('cap.felt-tiara');
  if (felt) { const c = rnd.pick(felt.colors); parts.push(P('cap.felt-dome', 'felt', 'head', c), P('cap.flaps', 'felt', 'head', c)); }
  const saka = has('cap.saka-pointed');
  if (saka) { const c = rnd.pick(saka.colors); parts.push(P('cap.saka-cone', 'felt', 'head', c), P('cap.flaps', 'felt', 'head', c)); }

  // shields
  const aspis = has('shield.aspis');
  if (aspis) {
    const face = rnd.pick(aspis.faces || ['bronze']);
    if (face === 'bronze') parts.push(P('shield.aspis-face', 'bronze', 'shield', bronze(rnd)));
    else parts.push(P('shield.aspis-face', 'paint', 'shield', face));
    parts.push(P('shield.aspis-rim', 'bronze', 'shield', bronze(rnd)));
    const dev = rnd.pick(aspis.devices || ['none']);
    if (dev !== 'none') {
      const dark = face === 'bronze' || face === '#e6dcc4' ? rnd.pick(['#1d1a17', '#8e2a1f']) : rnd.pick(['#e6dcc4', '#1d1a17', '#c9a24a']);
      parts.push(P('device.' + dev, 'paint', 'shield', face === '#1d1a17' ? '#e6dcc4' : dark));
    }
    meta.shield = 'aspis';
  }
  if (has('shield.spara')) { parts.push(P('shield.spara', 'wicker', 'shield', rnd.pick(['#c9a46a', '#b8925a', '#d1ae76'])), P('shield.spara-frame', 'leather', 'shield', '#5a3d26')); meta.shield = 'spara'; }

  // weapons
  const spear = kit.find((k) => k.render.part === 'weapon.spear');
  if (spear) {
    const L = spear.render.length; meta.spearLength = L; const g = 0.42 * L;
    parts.push(P('weapon.shaft', 'wood', 'spear', '#7a5634', M4([0, -g, 0], [0, 0, 0], [1, L, 1])),
      P('weapon.spearhead', spear.item === 'dory' ? 'bronze' : 'iron', 'spear', spear.item === 'dory' ? '#b98a4a' : '#8a8780', M4([0, L - g - 0.02, 0])),
      P('weapon.sauroter', 'bronze', 'spear', '#a87a3c', M4([0, -g, 0])));
  }
  if (has('weapon.scabbard-left')) parts.push(P('weapon.scabbard', 'leather', 'pelvis', '#3b2a1c'));
  if (has('weapon.dagger-right')) parts.push(P('weapon.dagger', 'leather', 'pelvis', '#3b2a1c'));
  if (has('weapon.axe-belt')) parts.push(P('weapon.axe', 'iron', 'pelvis', '#6d6a64'));
  if (has('weapon.bow')) {
    meta.bow = true;
    parts.push(P('weapon.bow', 'wood', 'bow', '#4a3020'), P('segment.string', 'dark', 'strTop', '#d8cfb8'), P('segment.string', 'dark', 'strBot', '#d8cfb8'),
      P('segment.arrow', 'wood', 'arrow', '#b89a6a'));
  }
  if (has('gear.quiver')) parts.push(P('gear.quiver', 'leather', 'chest', rnd.pick(['#6b4a2e', '#8a5a2b', '#5a3d26'])), P('gear.quiver-arrows', 'linen', 'chest', '#a8987a'));
  return { parts, meta };
}
function bronze(rnd) { return rnd.pick(['#c48e45', '#b9843f', '#cf9a52', '#b07a38']); }
