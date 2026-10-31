// Figure rig: turns a pose (a few numbers + hand targets) into world matrices
// for every frame the parts hang from. Legs/torso use forward kinematics, arms
// use analytic two-bone IK so behaviours can say "right hand here".
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UPPER = 0.29, FORE = 0.27;
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpV = V(), DOWN = V(0, -1, 0), UP = V(0, 1, 0);
const one = V(1, 1, 1);

function rotXYZ(m, x, y, z) { return m.makeRotationFromEuler(new THREE.Euler(x, y, z, 'YXZ')); }

export class Rig {
  constructor() {
    this.f = {};
    for (const k of ['root', 'pelvis', 'chest', 'head', 'lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin', 'spear', 'shield', 'bow', 'strTop', 'strBot', 'arrow'])
      this.f[k] = new THREE.Matrix4();
    this.hidden = new Set();
  }

  // pos: world Vector3, heading: radians (facing = (sin h, 0, cos h)), pose: see behaviours.js
  solve(pos, heading, pose, scale = 1) {
    const f = this.f; this.hidden.clear();
    // root (tilt = fall rotation about the feet)
    f.root.compose(V(pos.x, pos.y + (pose.lift || 0), pos.z), tmpQ.setFromEuler(new THREE.Euler(pose.tilt || 0, heading, pose.roll || 0, 'YXZ')), V(scale, scale, scale));
    f.pelvis.copy(f.root).multiply(tmpM.makeTranslation(0, 0.92 + (pose.bob || 0), 0)).multiply(rotXYZ(new THREE.Matrix4(), pose.lean || 0, pose.hipYaw || 0, 0));
    f.chest.copy(f.pelvis).multiply(tmpM.makeTranslation(0, 0.1, 0)).multiply(rotXYZ(new THREE.Matrix4(), pose.chestLean || 0, pose.twist || 0, 0));
    f.head.copy(f.chest).multiply(tmpM.makeTranslation(0, 0.52, 0)).multiply(rotXYZ(new THREE.Matrix4(), pose.headPitch || 0, pose.headYaw || 0, 0));
    // legs
    for (const s of ['l', 'r']) {
      const side = s === 'l' ? 1 : -1;
      f[s + 'Thigh'].copy(f.pelvis).multiply(tmpM.makeTranslation(0.095 * side, -0.02, 0)).multiply(rotXYZ(new THREE.Matrix4(), pose[s + 'Thigh'] || 0, 0, (pose.splay || 0.04) * side));
      f[s + 'Shin'].copy(f[s + 'Thigh']).multiply(tmpM.makeTranslation(0, -0.44, 0)).multiply(new THREE.Matrix4().makeRotationX(pose[s + 'Knee'] || 0));
    }
    // arms (IK). targets are given in 'chest' or 'root' space
    const hands = {};
    for (const s of ['l', 'r']) {
      const side = s === 'l' ? 1 : -1;
      const S = V(0.2 * side, 0.36, 0).applyMatrix4(f.chest);
      const tgt = pose[s + 'Hand'] || { p: [0.24 * side, -0.02, 0.04], space: 'chest' };
      const T = V(...tgt.p).applyMatrix4(tgt.space === 'root' ? f.root : f.chest);
      const pole = V(...(pose[s + 'Pole'] || [0.5 * side, -0.4, -0.8])).transformDirection(f.root);
      this._ik(S, T, pole, f[s + 'Upper'], f[s + 'Fore'], scale);
      hands[s] = T;
    }
    this.hands = hands;
    const rootQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(f.root));
    // spear: at right hand, direction in root space
    if (pose.spear) {
      const d = V(...pose.spear).normalize().applyQuaternion(rootQ);
      f.spear.compose(hands.r, tmpQ.setFromUnitVectors(UP, d), one);
    } else this.hidden.add('spear');
    // shield
    if (pose.shieldWorld) f.shield.copy(pose.shieldWorld);
    else if (pose.shield) {
      const sh = pose.shield;
      const p = V(...sh.p).applyMatrix4(sh.space === 'root' ? f.root : f.chest);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(sh.rot?.[0] || 0, sh.rot?.[1] || 0, sh.rot?.[2] || 0, 'YXZ'));
      f.shield.compose(p, rootQ.clone().multiply(q), one);
    } else this.hidden.add('shield');
    // bow + string + arrow
    if (pose.bow) {
      const b = pose.bow; // {aim (rad), nock: Vector3|null (world), arrow: bool, lowered: bool}
      const q = rootQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(b.lowered ? 0.2 : -b.aim, b.lowered ? 0 : 0, b.lowered ? 0.25 : 0, 'YXZ')));
      f.bow.compose(hands.l, q, one);
      const top = V(0, 0.56, -0.06).applyMatrix4(f.bow), bot = V(0, -0.56, -0.06).applyMatrix4(f.bow);
      const nock = b.draw > 0.02 ? hands.r.clone() : V(0, 0, -0.06).applyMatrix4(f.bow);
      seg(f.strTop, top, nock); seg(f.strBot, bot, nock);
      if (b.arrow) {
        const dir = V(0, 0, 1).applyQuaternion(q);
        const start = b.draw > 0.02 ? nock : hands.r.clone();
        seg(f.arrow, start, start.clone().add(dir.multiplyScalar(0.78)));
      } else this.hidden.add('arrow');
    } else { this.hidden.add('bow'); this.hidden.add('strTop'); this.hidden.add('strBot'); this.hidden.add('arrow'); }
    return f;
  }

  _ik(S, T, pole, upper, fore, scale) {
    const a = UPPER * scale, b = FORE * scale;
    const ST = T.clone().sub(S); let d = ST.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.01), (a + b) * 0.999);
    const dir = ST.normalize();
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().add(dir.clone().multiplyScalar(x)).add(pp.multiplyScalar(h));
    const Tc = S.clone().add(dir.clone().multiplyScalar(d));
    upper.compose(S, tmpQ.setFromUnitVectors(DOWN, E.clone().sub(S).normalize()), V(scale, scale, scale));
    fore.compose(E, tmpQ2.setFromUnitVectors(DOWN, Tc.clone().sub(E).normalize()), V(scale, scale, scale));
  }
}

function seg(m, A, B) {
  const d = B.clone().sub(A); const L = d.length() || 1e-4;
  m.compose(A, new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(L)), V(1, L, 1));
}
