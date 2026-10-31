// Reusable animation behaviours. Each returns a pose for the rig.
// Inputs (ctx): t, speed (m/s), gait (radians), lv (spears levelled 0..1),
// k (soldier constants: r1..r4 in [0,1)), meta (shield/bow/spear), plus
// behaviour-specific fields. Hand targets are in chest space unless noted.
const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const L = (a, b, t) => a + (b - a) * t;
const LV = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export function legs(pose, speed, gait, opts = {}) {
  const run = S(2.2, 4.5, speed), walk = S(0.05, 0.6, speed);
  const A = walk * L(0.42, 0.85, run), K = walk * L(0.55, 1.35, run);
  const s = Math.sin(gait), c = Math.cos(gait);
  pose.lThigh = -A * s; pose.rThigh = A * s;
  pose.lKnee = K * Math.max(0, c) + 0.05; pose.rKnee = K * Math.max(0, -c) + 0.05;
  pose.bob = walk * (L(0.02, 0.05, run) * Math.cos(2 * gait) - L(0.01, 0.04, run));
  pose.lean = (pose.lean || 0) + run * 0.2 + walk * 0.04;
  pose.hipYaw = walk * 0.08 * s;
  pose.twist = (pose.twist || 0) - walk * 0.1 * s;
  if (opts.brace) { // fighting stance: left foot forward, knees bent
    const w = 1 - walk; const sway = Math.sin(opts.t * 2.1 + opts.k * 9) * 0.05;
    pose.lThigh += w * (-0.42 + sway); pose.lKnee += w * 0.32; pose.rThigh += w * (0.32 - sway); pose.rKnee += w * 0.22;
    pose.bob += w * -0.045; pose.lean += w * 0.12;
  }
  return pose;
}

// ---- hoplite / spearman
const SPEAR_UP = [0, 1, 0.1], SPEAR_LEVEL = [0, -0.14, 1];
const R_CARRY = [-0.25, 0.07, 0.2], R_READY = [-0.21, 0.6, -0.04], R_THRUST = [-0.15, 0.5, 0.52];

function thrustCurve(t, period, phase) {
  const u = ((t / period + phase) % 1 + 1) % 1;
  if (u < 0.14) return S(0, 0.14, u);          // fast lunge
  if (u < 0.3) return 1;
  return 1 - S(0.3, 0.75, u);                  // slow recovery
}

export function spearman(ctx) {
  const { t, k, meta, mode } = ctx;
  const pose = { lean: 0, twist: 0 };
  let rHand = R_CARRY, spear = SPEAR_UP;
  const lv = ctx.lv;
  rHand = LV(R_CARRY, R_READY, lv); spear = norm(LV(SPEAR_UP, SPEAR_LEVEL, lv));
  let shieldP = [0.2, 0.18, 0.3], shieldYaw = 0.4, shieldPitch = 0.05;
  const fight = mode === 'fight-front' || mode === 'fight-press' || mode === 'wall-fight';
  if (mode === 'run') { shieldP = [0.15, 0.3, 0.36]; shieldYaw = 0.18; }
  if (fight) {
    const c = thrustCurve(t, 1.15 + k.r1 * 0.7, k.r2) * (mode === 'fight-press' ? 0.5 : 1);
    rHand = LV(R_READY, R_THRUST, c);
    spear = norm([Math.sin(k.r3 * 6) * 0.12, -0.16 - 0.08 * c, 1]);
    shieldP = [0.13, 0.27 + 0.03 * Math.sin(t * 3 + k.r1 * 7), 0.4 + 0.04 * c]; shieldYaw = 0.12;
    pose.lean = mode === 'fight-press' ? 0.22 : 0.1 + 0.08 * c; pose.twist = -0.25 * c;
  }
  if (mode === 'fight-rear') { // rear ranks: spears angled up-forward, shields pressed on
    rHand = [-0.25, 0.12, 0.24]; spear = norm([0, 0.9, 0.5 + 0.15 * Math.sin(t * 1.3 + k.r1 * 6)]);
    shieldP = [0.12, 0.26, 0.42]; shieldYaw = 0.1; pose.lean = 0.22;
  }
  if (mode === 'command') { // facing the troops, spear raised high
    const w = Math.sin(t * 3.2) * 0.5 + 0.5;
    rHand = [-0.22, 0.78 + 0.06 * w, 0.18]; spear = norm([-0.15, 1, 0.45 + 0.3 * w]);
    shieldP = [0.22, 0.12, 0.28]; shieldYaw = 0.55; pose.headPitch = -0.08;
  }
  if (mode === 'pose-march') { rHand = R_CARRY; spear = SPEAR_UP; }
  pose.rHand = { p: rHand, space: 'chest' };
  pose.spear = spear;
  if (meta.shield === 'aspis') {
    pose.shield = { p: shieldP, space: 'chest', rot: [shieldYaw, shieldPitch, 0] };
    pose.lHand = { p: [shieldP[0] - 0.1, shieldP[1] - 0.04, shieldP[2] - 0.12], space: 'chest' };
    pose.lPole = [0.9, -0.3, -0.2];
  }
  if (meta.shield === 'spara') {
    // planted wicker shield, top leaning back slightly; hand braces it
    pose.shield = { p: [0.06, 0.66, 0.46], space: 'root', rot: [0, -0.06, 0] };
    pose.lHand = { p: [0.12, 1.02, 0.38], space: 'root' };
    pose.lPole = [0.8, -0.5, -0.2];
  }
  pose.rPole = [-0.6, -0.5, -0.6];
  legs(pose, ctx.speed, ctx.gait, { brace: fight || mode === 'fight-rear', t, k: k.r4 });
  if (mode === 'command') pose.lean = 0.02;
  return pose;
}

// ---- archer: nock -> draw -> hold -> release cycle
export function archerCycle(t, k) {
  const period = 2.6 + k.r1 * 0.9, u = ((t / period + k.r2) % 1 + 1) % 1;
  let draw = 0, phase = 'nock';
  if (u < 0.25) { phase = 'nock'; draw = 0; } else if (u < 0.6) { phase = 'draw'; draw = S(0.25, 0.6, u); } else if (u < 0.72) { phase = 'hold'; draw = 1; } else { phase = 'recover'; draw = 0; }
  return { period, u, draw, phase };
}
export function archer(ctx) {
  const { t, k, mode } = ctx;
  const pose = { lean: 0, twist: 0 };
  if (mode === 'shoot' || mode === 'pose-draw') {
    const c = mode === 'pose-draw' ? { draw: 0.95, phase: 'hold', u: 0.65 } : archerCycle(t, k);
    const aim = 0.42 + k.r3 * 0.12, ca = Math.cos(aim), sa = Math.sin(aim);
    pose.twist = -0.55; pose.headYaw = 0.45; pose.headPitch = -0.12;
    const A = [0.0, 1.43, 0.06];
    const bowH = [A[0] + 0.05, A[1] + sa * 0.5, A[2] + ca * 0.5];
    const nock = [bowH[0] - 0.02, bowH[1] - sa * 0.06, bowH[2] - ca * 0.06];
    const full = [-0.07, 1.47, 0.03];
    const quiver = [-0.2, 1.2, -0.12];
    let r;
    if (c.phase === 'nock') r = LV(quiver, nock, S(0, 0.2, c.u));
    else if (c.phase === 'draw' || c.phase === 'hold') r = LV(nock, full, c.draw);
    else r = LV(full, quiver, S(0.72, 1, c.u));
    if (c.phase === 'recover') r = LV([-0.16, 1.5, -0.12], quiver, S(0.72, 1, c.u));
    pose.lHand = { p: bowH, space: 'root' }; pose.rHand = { p: r, space: 'root' };
    pose.lPole = [0.3, -0.8, -0.3]; pose.rPole = [-1, -0.2, -0.6];
    pose.bow = { aim, draw: c.phase === 'draw' || c.phase === 'hold' ? c.draw : 0, arrow: c.phase !== 'recover' && !(c.phase === 'nock' && c.u < 0.12) };
    pose.lThigh = -0.25; pose.rThigh = 0.2; pose.rKnee = 0.12; pose.lKnee = 0.1;
    return pose;
  }
  // holding / standing: bow lowered in left hand
  pose.lHand = { p: [0.26, 0.02, 0.14], space: 'chest' };
  pose.rHand = { p: [-0.25, 0.0, 0.06 + 0.03 * Math.sin(t * 1.7 + k.r1 * 5)], space: 'chest' };
  pose.bow = { aim: 0, draw: 0, arrow: false, lowered: true };
  pose.headYaw = Math.sin(t * 0.6 + k.r2 * 8) * 0.15;
  legs(pose, ctx.speed, ctx.gait);
  return pose;
}

// ---- rout: run away, arms pumping
export function rout(ctx, base) {
  const pose = { lean: 0.15, twist: 0 };
  const s = Math.sin(ctx.gait);
  pose.lHand = { p: [0.22, 0.12 + 0.05 * s, 0.12 * s], space: 'chest' };
  pose.rHand = { p: [-0.22, 0.12 - 0.05 * s, -0.12 * s], space: 'chest' };
  if (ctx.meta.spearLength) pose.spear = norm([0, 0.7, -0.6]);
  if (ctx.meta.bow) pose.bow = { aim: 0, draw: 0, arrow: false, lowered: true };
  if (ctx.meta.shield === 'aspis') pose.shield = { p: [0.2, 0.18, 0.2], space: 'chest', rot: [0.6, 0, 0] };
  pose.headYaw = Math.sin(ctx.t * 1.3 + ctx.k.r1 * 9) * 0.35;
  return legs(pose, ctx.speed, ctx.gait);
}

// ---- fall: topple and stay down (applied on top of the last pose)
export function fall(pose, p, k) {
  const e = p * p; // gravity-like
  const back = k.r3 < 0.7 ? -1 : 1;
  pose.tilt = back * 1.5 * e; pose.lift = 0.13 * e; pose.roll = (k.r4 - 0.5) * 0.4 * e;
  if (p > 0.3) {
    const w = S(0.3, 1, p);
    pose.lThigh = L(pose.lThigh || 0, -0.3, w); pose.rThigh = L(pose.rThigh || 0, 0.1, w); pose.lKnee = L(pose.lKnee || 0, 0.6, w); pose.rKnee = L(pose.rKnee || 0, 0.2, w);
    pose.bob = 0; pose.lean = L(pose.lean || 0, 0, w);
  }
  return pose;
}
