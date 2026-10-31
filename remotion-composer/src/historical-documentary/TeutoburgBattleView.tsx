import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { palette, sans, serif } from "../historical-short/theme";
import { BattleCameraKey, BattleScene, BattleTimes } from "./types";

// ORIGINAL TACTICAL RECONSTRUCTION — schematic top-down view of a Roman
// marching column ambushed on a forest track between a wooded hill (south)
// and wetland (north), the terrain type described by Cassius Dio and found at
// Kalkriese (a proposed, debated site). Unit counts, order of march and
// warband positions are illustrative, NOT attested. Everything is a pure
// function of the narration clock t, so consecutive scenes stay continuous.

const W = 1920;
const H = 1080;
const WW = 3200; // world size
const WH = 1800;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const prog = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: ease });
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

const ROMAN = "#c8372d";
const ROMAN_DARK = "#a3342b";
const AUX = "#e0895a";
const HORSE = "#8b5e3c";
const WAGON = "#7a5530";
const MULE = "#a07d55";
const FOLLOWER = "#b9b0a0";
const GERMAN = "#e3b858";

// ------------------------------------------------------------------ rng
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ terrain
const northEdge = (x: number) => 855 + 34 * Math.sin(x / 260) + 22 * Math.sin(x / 97 + 2);
const southEdge = (x: number) => 1085 + 30 * Math.sin(x / 310 + 1) + 20 * Math.sin(x / 120);
const bogEdge = (x: number) => 500 + 55 * Math.sin(x / 420 + 0.5) + 20 * Math.sin(x / 150);

const CTRL: [number, number][] = [
  [3300, 990],
  [2980, 955],
  [2680, 1005],
  [2380, 950],
  [2080, 992],
  [1780, 942],
  [1480, 988],
  [1180, 938],
  [880, 982],
  [580, 934],
  [280, 972],
  [-100, 940],
];

// dense Catmull-Rom sampling of the track (east -> west), with arc length
const TRACK = (() => {
  const pts: [number, number][] = [];
  const P = [CTRL[0], ...CTRL, CTRL[CTRL.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    for (let k = 0; k < 24; k++) {
      const u = k / 24;
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(CTRL[CTRL.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
})();

const at = (s: number) => {
  const { pts, cum } = TRACK;
  const ss = Math.max(0, Math.min(TRACK.length - 0.01, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= ss) lo = mid;
    else hi = mid;
  }
  const f = (ss - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  const x = lerp(pts[lo][0], pts[hi][0], f);
  const y = lerp(pts[lo][1], pts[hi][1], f);
  const ang = Math.atan2(pts[hi][1] - pts[lo][1], pts[hi][0] - pts[lo][0]); // direction of march (west)
  // unit normal pointing south (screen +y) for a westward march (ang ~ pi)
  return { x, y, ang, nx: Math.sin(ang), ny: -Math.cos(ang) };
};

// static scenery (deterministic)
const SCENERY = (() => {
  const r = rng(9);
  const trees: { x: number; y: number; r: number; shade: number }[] = [];
  for (let i = 0; i < 950; i++) {
    const x = -120 + r() * (WW + 240);
    const y = southEdge(x) + 6 + Math.pow(r(), 0.8) * (WH + 120 - southEdge(x));
    trees.push({ x, y, r: 15 + r() * 14, shade: r() });
  }
  for (let i = 0; i < 520; i++) {
    const x = -120 + r() * (WW + 240);
    const top = bogEdge(x) + 10;
    const y = top + r() * (northEdge(x) - top - 4);
    trees.push({ x, y, r: 13 + r() * 12, shade: r() });
  }
  for (let i = 0; i < 260; i++) {
    const x = -60 + r() * (WW + 120);
    const y = northEdge(x) + r() * (southEdge(x) - northEdge(x));
    // keep clear of the track
    let near = false;
    for (let s = 0; s < TRACK.length; s += 40) {
      const p = at(s);
      if (Math.hypot(p.x - x, p.y - y) < 52) {
        near = true;
        break;
      }
    }
    if (!near) trees.push({ x, y, r: 10 + r() * 8, shade: r() });
  }
  trees.sort((a, b) => a.y - b.y);
  const tufts: [number, number][] = [];
  for (let i = 0; i < 260; i++) {
    const x = -100 + r() * (WW + 200);
    tufts.push([x, -100 + r() * (bogEdge(x) + 80)]);
  }
  const ponds: { x: number; y: number; rx: number; ry: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const x = r() * WW;
    ponds.push({ x, y: 40 + r() * (bogEdge(x) - 120), rx: 40 + r() * 90, ry: 14 + r() * 26 });
  }
  const mud: { s: number; off: number; rx: number; ry: number }[] = [];
  for (let i = 0; i < 70; i++) mud.push({ s: r() * TRACK.length, off: (r() - 0.5) * 30, rx: 14 + r() * 26, ry: 6 + r() * 8 });
  const rain: { x: number; y: number; v: number; l: number }[] = [];
  for (let i = 0; i < 260; i++) rain.push({ x: r() * (W + 300), y: r() * H, v: 0.8 + r() * 0.6, l: 18 + r() * 22 });
  const edgePath = (f: (x: number) => number, y2: number) => {
    let d = `M-200 ${y2}`;
    for (let x = -200; x <= WW + 200; x += 40) d += ` L${x} ${f(x).toFixed(1)}`;
    return d + ` L${WW + 200} ${y2} Z`;
  };
  const contours: string[] = [];
  for (let k = 1; k <= 6; k++) {
    let d = "";
    for (let x = -200; x <= WW + 200; x += 40) {
      const y = southEdge(x) + k * 95 + 18 * Math.sin(x / (180 + k * 30) + k);
      d += `${d ? " L" : "M"}${x} ${y.toFixed(1)}`;
    }
    contours.push(d);
  }
  const trackD = "M" + TRACK.pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L");
  return {
    trees,
    tufts,
    ponds,
    mud,
    rain,
    contours,
    trackD,
    forestSouth: edgePath(southEdge, WH + 300),
    passage: edgePath(northEdge, WH + 300),
    woodsNorth: edgePath(bogEdge, WH + 300),
  };
})();

// ------------------------------------------------------------------ column
type Kind = "leg" | "aux" | "cav" | "wagon" | "mule" | "follower" | "eagle";
interface Pip {
  kind: Kind;
  d: number; // distance behind the column head along the track
  across: number; // lateral offset
  block: number; // block id (for regrouping)
  seed: number;
  legion?: number;
}
interface BlockInfo {
  id: number;
  kind: Kind;
  d: number; // block centre distance behind head
  size: number;
  legion?: number;
}

const COLUMN = (() => {
  const pips: Pip[] = [];
  const blocks: BlockInfo[] = [];
  const r = rng(77);
  let bid = 0;
  const addBlock = (kind: Kind, d0: number, cols: number, rows: number, step: number, legion?: number) => {
    const id = bid++;
    for (let row = 0; row < rows; row++)
      for (let c = 0; c < cols; c++)
        pips.push({ kind, d: d0 + row * step, across: (c - (cols - 1) / 2) * step, block: id, seed: r(), legion });
    blocks.push({ id, kind, d: d0 + ((rows - 1) * step) / 2, size: cols * rows, legion });
  };
  addBlock("aux", 0, 3, 5, 10);
  addBlock("aux", 62, 3, 5, 10);
  addBlock("cav", 130, 2, 5, 14);
  const eagles: { d: number; legion: number }[] = [];
  for (let L = 0; L < 3; L++) {
    const base = 230 + L * 760;
    eagles.push({ d: base, legion: L });
    pips.push({ kind: "eagle", d: base, across: 0, block: -1, seed: r(), legion: L });
    for (let j = 0; j < 5; j++) addBlock("leg", base + 26 + j * 74, 4, 6, 10, L);
    for (let j = 0; j < 4; j++) {
      const id = bid++;
      pips.push({ kind: "wagon", d: base + 420 + j * 46, across: 0, block: id, seed: r(), legion: L });
      blocks.push({ id, kind: "wagon", d: base + 420 + j * 46, size: 1, legion: L });
    }
    for (let j = 0; j < 8; j++) pips.push({ kind: "mule", d: base + 610 + j * 15, across: (j % 2 ? 7 : -7), block: -2, seed: r(), legion: L });
    for (let j = 0; j < 9; j++)
      pips.push({ kind: "follower", d: base + 600 + r() * 120, across: (r() - 0.5) * 34, block: -3, seed: r(), legion: L });
  }
  addBlock("aux", 2520, 3, 5, 10);
  addBlock("cav", 2590, 2, 5, 14);
  const length = 2660;
  return { pips, blocks, eagles, length };
})();

// ------------------------------------------------------------------ warbands
interface Band {
  x: number;
  y: number;
  side: 1 | -1; // 1 = south (hill), -1 = north
  act: number; // activation time (set per scene times)
  s: number; // track arc position it strikes
  warriors: { dx: number; dy: number; ph: number }[];
  primary: boolean;
}

const BAND_DEFS: { x: number; side: 1 | -1; primary?: boolean }[] = [
  { x: 520, side: 1 },
  { x: 820, side: 1 },
  { x: 1120, side: 1 },
  { x: 1420, side: 1, primary: true },
  { x: 1720, side: 1, primary: true },
  { x: 2020, side: 1, primary: true },
  { x: 2320, side: 1 },
  { x: 2620, side: 1 },
  { x: 2920, side: 1 },
  { x: 700, side: -1 },
  { x: 1300, side: -1 },
  { x: 1880, side: -1, primary: true },
  { x: 2450, side: -1 },
];

const nearestS = (x: number) => {
  let best = 0;
  let bd = 1e9;
  for (let s = 0; s < TRACK.length; s += 6) {
    const d = Math.abs(at(s).x - x);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
};

const makeBands = (T: BattleTimes): Band[] => {
  const r = rng(31);
  const prim = BAND_DEFS.filter((b) => b.primary);
  const centre = 1720;
  return BAND_DEFS.map((b, i) => {
    const y = b.side === 1 ? southEdge(b.x) + 70 + r() * 40 : northEdge(b.x) - 70 - r() * 30;
    const warriors = Array.from({ length: 16 }, () => {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 40;
      return { dx: Math.cos(a) * rr * 1.25, dy: Math.sin(a) * rr * 0.8, ph: r() * 6.28 };
    });
    let act: number;
    if (b.primary) {
      const k = prim.indexOf(b);
      act = T.attack + k * 0.45;
    } else {
      const dist = Math.abs(b.x - centre) / 1300;
      act = lerp(T.spread[0], T.spread[1], Math.min(1, dist)) + (b.side === -1 ? 0.3 : 0) + i * 0.01;
    }
    return { x: b.x, y, side: b.side, act, s: nearestS(b.x), warriors, primary: !!b.primary };
  });
};

// ------------------------------------------------------------------ camera
const cameraAt = (keys: BattleCameraKey[], t: number) => {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const p = ease((t - a.t) / Math.max(0.001, b.t - a.t));
      return {
        t,
        x: lerp(a.x, b.x, p),
        y: lerp(a.y, b.y, p),
        zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), p)),
      };
    }
  }
  return keys[keys.length - 1];
};

// ------------------------------------------------------------------ view
export const TeutoburgBattleView: React.FC<{ scene: BattleScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const T = scene.times;
  const cam = cameraAt(scene.camera, t);
  const toScreen = (x: number, y: number): [number, number] => [(x - cam.x) * cam.zoom + W / 2, (y - cam.y) * cam.zoom + H / 2];

  // column head position (arc length from the east end)
  const headEnd = TRACK.length - 330;
  const v = (headEnd - 0) / Math.max(0.1, T.marchUntil - T.columnEnter);
  const head = Math.min(headEnd, Math.max(-COLUMN.length - 50, (t - T.columnEnter) * v));
  const marching = t < T.marchUntil ? 1 : 0;

  const bands = makeBands(T);
  const collapse = prog(t, T.collapse[0], T.collapse[1]);
  const after = T.aftermath !== undefined ? prog(t, T.aftermath, T.aftermath + 1.2) : 0;
  const regroupWindow = prog(t, T.regroup[0], T.regroup[1]);
  const rain = Math.min(prog(t, T.rain[0], T.rain[0] + 1), 1 - prog(t, T.rain[1] - 1, T.rain[1]));

  // block centres + the nearest active band (for regroup facing)
  const blockCentre = new Map<number, { x: number; y: number; s: number }>();
  for (const b of COLUMN.blocks) {
    const s = head - b.d;
    const p = at(s);
    blockCentre.set(b.id, { x: p.x, y: p.y, s });
  }
  const threatAt = (s: number) => {
    // strongest active band pressure near arc position s (0..1)
    let m = 0;
    for (const b of bands) {
      const a = prog(t, b.act, b.act + 1.4);
      if (a <= 0) continue;
      const d = Math.abs(b.s - s);
      m = Math.max(m, a * Math.max(0, 1 - d / 520));
    }
    return m;
  };

  // ---------------------------------------------- pips (world coordinates)
  const pipEls: React.ReactNode[] = [];
  const eagleScreens: { x: number; y: number; legion: number }[] = [];
  COLUMN.pips.forEach((pp, i) => {
    const s = head - pp.d;
    if (s < -20 || s > TRACK.length) return;
    const p = at(s);
    const bob = marching ? Math.sin(t * 7 + pp.seed * 20) * 1.2 : 0;
    let x = p.x + p.nx * (pp.across + bob);
    let y = p.y + p.ny * (pp.across + bob);
    const threat = threatAt(s);
    // regroup: legion and aux blocks contract into tight knots facing outward
    if ((pp.kind === "leg" || pp.kind === "aux") && pp.block >= 0) {
      const c = blockCentre.get(pp.block)!;
      const rg = Math.min(regroupWindow, 0.25 + threat) * (0.55 + pp.seed * 0.45);
      const idx = pp.seed * 1000;
      const ring = 9 + (Math.floor(idx) % 3) * 9;
      const ang = idx;
      x = lerp(x, c.x + Math.cos(ang) * ring, rg * 0.85);
      y = lerp(y, c.y + Math.sin(ang) * ring, rg * 0.85);
    }
    // pressure jitter
    const jit = threat * (1 - collapse * 0.3) * 3.2;
    x += Math.sin(t * 13 + pp.seed * 40) * jit;
    y += Math.cos(t * 11 + pp.seed * 33) * jit;
    // collapse: scatter and fade
    let op = 1;
    let fill: string | null = null;
    if (collapse > 0) {
      const local = Math.min(1, collapse * (0.8 + pp.seed * 0.6));
      const a = pp.seed * 97;
      const dist = 20 + pp.seed * 70;
      x += Math.cos(a) * dist * local;
      y += Math.sin(a) * dist * local * 0.8;
      op = 1 - local * (pp.seed < 0.55 ? 0.85 : 0.35);
      fill = local > 0.35 ? ROMAN_DARK : null;
    }
    const deg = (p.ang * 180) / Math.PI + (after > 0 && pp.kind === "wagon" ? 35 * after * (pp.seed > 0.5 ? 1 : -1) : 0);
    if (after > 0 && (pp.kind === "leg" || pp.kind === "aux" || pp.kind === "cav")) {
      // abandoned equipment: dropped shields and kit (generic, schematic)
      pipEls.push(
        <rect
          key={i}
          x={x - 4}
          y={y - 2.5}
          width={8}
          height={5}
          rx={1.5}
          fill={after > 0.5 ? "#6d5c48" : fill ?? ROMAN}
          opacity={Math.max(op, 0.35) * (pp.seed < 0.5 ? 0.9 : 0.5)}
          transform={`rotate(${pp.seed * 360} ${x} ${y})`}
        />,
      );
      return;
    }
    if (pp.kind === "eagle") {
      const [sx, sy] = toScreen(x, y);
      eagleScreens.push({ x: sx, y: sy, legion: pp.legion ?? 0 });
      pipEls.push(
        <g key={i} opacity={Math.max(op, 0.5)}>
          <circle cx={x} cy={y} r={9} fill={palette.gold} stroke="#3a2a10" strokeWidth={2.5} />
          <path d={`M${x - 7} ${y - 2} L${x} ${y + 3} L${x + 7} ${y - 2}`} stroke="#3a2a10" strokeWidth={2} fill="none" />
        </g>,
      );
      return;
    }
    if (pp.kind === "leg") {
      pipEls.push(<rect key={i} x={x - 3.5} y={y - 4} width={7} height={8} rx={1.2} fill={fill ?? ROMAN} opacity={op} transform={`rotate(${deg} ${x} ${y})`} />);
    } else if (pp.kind === "aux") {
      pipEls.push(<ellipse key={i} cx={x} cy={y} rx={3.8} ry={3.8} fill={fill ?? AUX} opacity={op} />);
    } else if (pp.kind === "cav") {
      pipEls.push(
        <g key={i} opacity={op} transform={`rotate(${deg} ${x} ${y})`}>
          <ellipse cx={x} cy={y} rx={8} ry={3.6} fill={fill ?? HORSE} />
          <circle cx={x - 1} cy={y} r={2.6} fill={fill ?? ROMAN} />
        </g>,
      );
    } else if (pp.kind === "wagon") {
      pipEls.push(
        <g key={i} opacity={Math.max(op, 0.6)} transform={`rotate(${deg} ${x} ${y})`}>
          <rect x={x - 12} y={y - 7} width={24} height={14} rx={2} fill={WAGON} stroke="#2a1b0e" strokeWidth={1.5} />
          <ellipse cx={x - 21} cy={y - 4} rx={5} ry={2.6} fill="#6b5236" />
          <ellipse cx={x - 21} cy={y + 4} rx={5} ry={2.6} fill="#6b5236" />
        </g>,
      );
    } else if (pp.kind === "mule") {
      pipEls.push(
        <g key={i} opacity={op} transform={`rotate(${deg} ${x} ${y})`}>
          <ellipse cx={x} cy={y} rx={5.5} ry={2.8} fill={MULE} />
          <rect x={x - 2} y={y - 3.4} width={4} height={6.8} fill="#5c4630" />
        </g>,
      );
    } else if (pp.kind === "follower") {
      pipEls.push(<circle key={i} cx={x} cy={y} r={2.4} fill={FOLLOWER} opacity={op * 0.9} />);
    }
  });

  // ---------------------------------------------- warbands
  const wardsIn = prog(t, T.wardsIn, T.wardsIn + 1.2);
  const bandEls: React.ReactNode[] = [];
  const arrowEls: React.ReactNode[] = [];
  const flashEls: React.ReactNode[] = [];
  const missileEls: React.ReactNode[] = [];
  bands.forEach((b, bi) => {
    const a = prog(t, b.act, b.act + 1.4);
    const tgt = at(b.s);
    const standOff = lerp(46, 16, collapse);
    const tx = tgt.x + tgt.nx * standOff * b.side;
    const ty = tgt.y + tgt.ny * standOff * b.side;
    const cxp = lerp(b.x, tx, a);
    const cyp = lerp(b.y, ty, a);
    const hidden = a <= 0;
    const op = (hidden ? wardsIn * 0.62 : 1) * (1 - after);
    if (op <= 0) return;
    const spreadK = lerp(1, 1.5, a) + collapse * 0.6;
    b.warriors.forEach((w, wi) => {
      const jx = Math.sin(t * (hidden ? 1.5 : 9) + w.ph) * (hidden ? 1.2 : 2.6);
      const jy = Math.cos(t * (hidden ? 1.3 : 8) + w.ph) * (hidden ? 1.2 : 2.6);
      bandEls.push(
        <circle key={`${bi}-${wi}`} cx={cxp + w.dx * spreadK + jx} cy={cyp + w.dy * spreadK + jy} r={4.2} fill={GERMAN} stroke="#3b2c0c" strokeWidth={1.2} opacity={op} />,
      );
    });
    if (hidden && wardsIn > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + bi);
      bandEls.push(
        <ellipse key={`h${bi}`} cx={b.x} cy={b.y} rx={68} ry={46} fill="none" stroke={GERMAN} strokeWidth={2.5} strokeDasharray="8 7" opacity={wardsIn * (0.35 + 0.35 * pulse)} />,
      );
    }
    // attack arrow
    const ap = prog(t, b.act - 0.15, b.act + 0.55);
    const afade = 1 - prog(t, b.act + 2.6, b.act + 3.4);
    if (ap > 0 && afade > 0 && collapse < 0.5) {
      const x1 = b.x;
      const y1 = b.y - b.side * 10;
      const x2 = lerp(x1, tx, ap);
      const y2 = lerp(y1, ty - b.side * 6, ap);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const hl = 22;
      arrowEls.push(
        <g key={`ar${bi}`} opacity={afade}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.6)" strokeWidth={13} strokeLinecap="round" />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={GERMAN} strokeWidth={8} strokeLinecap="round" />
          <polygon
            points={`${x2 + Math.cos(ang) * hl * 0.6},${y2 + Math.sin(ang) * hl * 0.6} ${x2 + Math.cos(ang + 2.5) * hl},${y2 + Math.sin(ang + 2.5) * hl} ${x2 + Math.cos(ang - 2.5) * hl},${y2 + Math.sin(ang - 2.5) * hl}`}
            fill={GERMAN}
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={2}
          />
        </g>,
      );
    }
    // impact flash on arrival
    const fl = interpolate(t, [b.act + 1.1, b.act + 1.9], [0, 1], clamp);
    if (fl > 0 && fl < 1) {
      flashEls.push(<circle key={`f${bi}`} cx={tgt.x} cy={tgt.y} r={20 + fl * 70} fill="none" stroke="#ffd98a" strokeWidth={5 * (1 - fl)} opacity={1 - fl} />);
    }
    // missiles from the tree line (Dio: weapons hurled from the woods)
    if (t > Math.max(b.act - 0.3, T.missiles[0]) && t < T.missiles[1]) {
      for (let k = 0; k < 5; k++) {
        const cyc = ((t - b.act) * 1.6 + k / 5) % 1;
        const sx = b.x + (k - 2) * 26;
        const sy = b.y - b.side * 30;
        const ex = tgt.x + (k - 2) * 18;
        const ey = tgt.y + b.side * 6;
        const mx = lerp(sx, ex, cyc);
        const my = lerp(sy, ey, cyc);
        const ang = Math.atan2(ey - sy, ex - sx);
        missileEls.push(
          <line key={`ms${bi}-${k}`} x1={mx} y1={my} x2={mx - Math.cos(ang) * 16} y2={my - Math.sin(ang) * 16} stroke="#f3e2b0" strokeWidth={2} opacity={0.9 * (1 - cyc * 0.3)} />,
        );
      }
    }
  });

  // ---------------------------------------------- overlays in screen space
  const sightP = Math.min(prog(t, T.sightlines[0], T.sightlines[0] + 0.8), 1 - prog(t, T.sightlines[1] - 0.6, T.sightlines[1]));
  const sightEls: React.ReactNode[] = [];
  if (sightP > 0) {
    [900, 1700, 2500].forEach((sx, k) => {
      const s0 = nearestS(sx);
      const p = at(s0);
      const rays = [];
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        // ray ends at the first tree line (north/south edges)
        let len = 260;
        const dy = Math.sin(ang);
        if (dy > 0.05) len = Math.min(len, (southEdge(p.x) - p.y) / dy);
        if (dy < -0.05) len = Math.min(len, (northEdge(p.x) - p.y) / dy);
        rays.push([p.x + Math.cos(ang) * len * sightP, p.y + dy * len * sightP]);
      }
      sightEls.push(
        <g key={`sl${k}`} opacity={0.85 * sightP}>
          <polygon points={rays.map((q) => q.join(",")).join(" ")} fill="rgba(240,235,220,0.13)" stroke="rgba(240,235,220,0.5)" strokeWidth={2} strokeDasharray="6 6" />
          <circle cx={p.x} cy={p.y} r={7} fill="#f1e6cc" />
        </g>,
      );
    });
  }

  const wallP = prog(t, T.wall, T.wall + 1.2);
  let wallD = "";
  for (let x = 1100; x <= 1100 + 800 * wallP; x += 22) {
    const y = southEdge(x) - 14 + (Math.round(x / 22) % 2 ? 4 : -4);
    wallD += `${wallD ? " L" : "M"}${x} ${y.toFixed(1)}`;
  }

  // screen-space labels
  const L = (x: number, y: number, text: string, o: number, color = palette.parchment, size = 22, anchor: "start" | "middle" | "end" = "middle") => {
    if (o <= 0) return null;
    const [sx, sy] = toScreen(x, y);
    return (
      <text
        x={sx}
        y={sy}
        textAnchor={anchor}
        fontFamily={sans}
        fontWeight={700}
        fontSize={size}
        letterSpacing={2.5}
        fill={color}
        opacity={o}
        stroke="rgba(0,0,0,0.78)"
        strokeWidth={5}
        style={{ paintOrder: "stroke" }}
      >
        {text}
      </text>
    );
  };
  const callP = Math.min(prog(t, T.callouts[0], T.callouts[0] + 0.5), 1 - prog(t, T.callouts[1] - 0.5, T.callouts[1]));
  const callout = (d: number, text: string, side: 1 | -1, delay: number, len = 95) => {
    const o = callP * prog(t, T.callouts[0] + delay, T.callouts[0] + delay + 0.5);
    if (o <= 0) return null;
    const s = head - d;
    if (s < 0 || s > TRACK.length) return null;
    const p = at(s);
    const [x1, y1] = toScreen(p.x + p.nx * 14 * side, p.y + p.ny * 14 * side);
    if (x1 < 200 || x1 > W - 200) return null;
    const y2 = y1 + len * side;
    return (
      <g key={text} opacity={o}>
        <line x1={x1} y1={y1} x2={x1} y2={y2} stroke={palette.parchment} strokeWidth={2} />
        <circle cx={x1} cy={y1} r={4} fill={palette.parchment} />
        <text
          x={x1}
          y={y2 + (side === 1 ? 26 : -12)}
          textAnchor="middle"
          fontFamily={sans}
          fontWeight={700}
          fontSize={21}
          letterSpacing={2}
          fill={palette.parchment}
          stroke="rgba(0,0,0,0.8)"
          strokeWidth={5}
          style={{ paintOrder: "stroke" }}
        >
          {text}
        </text>
      </g>
    );
  };

  const stretchO = Math.min(prog(t, T.stretched, T.stretched + 0.6), 1 - prog(t, T.attack - 0.3, T.attack + 0.3));
  const headPt = at(head);
  const tailPt = at(head - COLUMN.length);
  const [hx, hy] = toScreen(headPt.x, headPt.y);
  const [tx2] = toScreen(tailPt.x, tailPt.y);

  const insetO = Math.min(prog(t, T.inset[0], T.inset[0] + 0.5), 1 - prog(t, T.inset[1] - 0.5, T.inset[1]));
  const intro = prog(t, scene.start, scene.start + 0.5);

  const heading = [...scene.headings].reverse().find((h) => t >= h.at);
  const headingO = heading ? prog(t, heading.at, heading.at + 0.45) : 0;

  const eagleTimes = T.eagles;
  const legNames = ["XVII", "XVIII", "XIX"];

  return (
    <AbsoluteFill style={{ backgroundColor: "#141a12" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="bogfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d2a28" />
            <stop offset="100%" stopColor="#263329" />
          </linearGradient>
          <linearGradient id="hillfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f2a18" />
            <stop offset="100%" stopColor="#2b3520" />
          </linearGradient>
        </defs>
        <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`}>
          {/* ground layers */}
          <rect x={-400} y={-400} width={WW + 800} height={WH + 800} fill="url(#bogfill)" />
          {SCENERY.ponds.map((p, i) => (
            <ellipse key={`p${i}`} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry} fill="#2f4446" opacity={0.75} />
          ))}
          {SCENERY.tufts.map(([x, y], i) => (
            <path key={`u${i}`} d={`M${x - 6} ${y} L${x - 2} ${y - 8} M${x} ${y} L${x} ${y - 10} M${x + 6} ${y} L${x + 2} ${y - 8}`} stroke="#5d7254" strokeWidth={2} opacity={0.7} />
          ))}
          <path d={SCENERY.woodsNorth} fill="#24301d" />
          <path d={SCENERY.passage} fill="#3a3a26" />
          <path d={SCENERY.forestSouth} fill="url(#hillfill)" />
          {SCENERY.contours.map((d, i) => (
            <path key={`c${i}`} d={d} fill="none" stroke="rgba(200,190,150,0.10)" strokeWidth={3} />
          ))}
          {/* track */}
          <path d={SCENERY.trackD} fill="none" stroke="#2a2218" strokeWidth={60} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          <path d={SCENERY.trackD} fill="none" stroke="#6b5636" strokeWidth={44} strokeLinecap="round" strokeLinejoin="round" />
          {SCENERY.mud.map((m, i) => {
            const p = at(m.s);
            return <ellipse key={`md${i}`} cx={p.x + p.nx * m.off} cy={p.y + p.ny * m.off} rx={m.rx} ry={m.ry} fill="#4a3b25" opacity={0.55 + rain * 0.35} />;
          })}
          {wallP > 0 ? (
            <g>
              <path d={wallD} fill="none" stroke="#1a140c" strokeWidth={14} strokeLinejoin="round" />
              <path d={wallD} fill="none" stroke="#b08a4a" strokeWidth={7} strokeLinejoin="round" />
            </g>
          ) : null}
          {/* trees */}
          {SCENERY.trees.map((tr, i) => (
            <g key={`tr${i}`}>
              <circle cx={tr.x + 4} cy={tr.y + 5} r={tr.r} fill="rgba(0,0,0,0.35)" />
              <circle cx={tr.x} cy={tr.y} r={tr.r} fill={tr.shade > 0.5 ? "#2c3c22" : "#33462a"} />
              <circle cx={tr.x - tr.r * 0.3} cy={tr.y - tr.r * 0.3} r={tr.r * 0.45} fill="#46603a" opacity={0.55} />
            </g>
          ))}
          {sightEls}
          {/* column + warbands */}
          {pipEls}
          {missileEls}
          {bandEls}
          {arrowEls}
          {flashEls}
        </g>
        {/* rain + dimming */}
        {rain > 0 ? (
          <g opacity={rain}>
            <rect width={W} height={H} fill="rgba(18,26,34,0.22)" />
            {SCENERY.rain.map((d, i) => {
              const yy = (d.y + t * 900 * d.v) % (H + 60) - 30;
              const xx = ((d.x - t * 260 * d.v) % (W + 300) + W + 300) % (W + 300) - 150;
              return <line key={`rn${i}`} x1={xx} y1={yy} x2={xx - d.l * 0.28} y2={yy + d.l} stroke="rgba(200,215,230,0.38)" strokeWidth={1.6} />;
            })}
          </g>
        ) : null}

        {/* terrain labels */}
        <g opacity={(scene.hideHeading ? 0 : 1) * intro * (1 - collapse) * interpolate(cam.zoom, [0.75, 0.9], [1, 0], clamp)}>
          {L(600, 1500, "WOODED HILL", 0.85, "#c9d4b0", 24)}
          {L(1350, 330, "WETLAND / BOG", 0.85, "#b5cfc8", 24)}
          {L(900, 720, "DENSE WOODS", 0.7, "#c9d4b0", 20)}
          {L(400, 1035, "FOREST TRACK", t < T.marchUntil ? 0.85 : 0, "#e7d6aa", 20)}
        </g>
        {L(1500, southEdge(1500) + 46, "TURF WALL — FOUND AT KALKRIESE, INTERPRETED AS A GERMANIC RAMPART", wallP * (1 - prog(t, T.wall + 3, T.wall + 3.6)), "#e7c98a", 17)}
        {L(1700, 860, "ROMAN VIEW BLOCKED BY TREES", sightP, palette.parchment, 20)}
        {after > 0 ? L(1650, 870, "ABANDONED WAGONS AND EQUIPMENT (SCHEMATIC)", after, palette.parchment, 20) : null}
        {L(1720, 1330, "HIDDEN WARBANDS", wardsIn * (1 - prog(t, T.wardsIn + 4, T.wardsIn + 4.6)), GERMAN, 22)}
        {(() => {
          // column arrival label
          const o = prog(t, T.columnEnter + 0.3, T.columnEnter + 0.9) * (1 - prog(t, T.columnEnter + 2.2, T.columnEnter + 2.6));
          if (o <= 0 || head < 0) return null;
          const [sx, sy] = toScreen(headPt.x, headPt.y);
          return (
            <text x={Math.min(sx, W - 40) - 20} y={sy - 40} textAnchor="end" fontFamily={sans} fontWeight={700} fontSize={22} letterSpacing={2} fill="#ff8a7e" opacity={o} stroke="rgba(0,0,0,0.8)" strokeWidth={5} style={{ paintOrder: "stroke" }}>
              ← ROMAN COLUMN APPROACHING
            </text>
          );
        })()}

        {/* unit callouts during the march */}
        {callout(30, "AUXILIARIES", -1, 0.0)}
        {callout(150, "CAVALRY", 1, 0.3)}
        {callout(232, "EAGLE STANDARD · LEGIO XVII", -1, 0.6, 120)}
        {callout(370, "LEGIONARIES", 1, 0.9)}
        {callout(700, "WAGONS", -1, 1.3)}
        {callout(880, "PACK ANIMALS", 1, 1.7)}
        {callout(905, "CAMP FOLLOWERS", -1, 2.1, 130)}
        {callout(990, "LEGIO XVIII", 1, 2.5, 120)}
        {callout(1750, "LEGIO XIX", -1, 2.9, 120)}

        {/* stretched column bracket */}
        {stretchO > 0 ? (
          <g opacity={stretchO}>
            <line x1={hx} y1={hy - 70} x2={tx2} y2={hy - 70} stroke={palette.gold} strokeWidth={3} />
            <line x1={hx} y1={hy - 84} x2={hx} y2={hy - 56} stroke={palette.gold} strokeWidth={3} />
            <line x1={tx2} y1={hy - 84} x2={tx2} y2={hy - 56} stroke={palette.gold} strokeWidth={3} />
            <text x={(hx + tx2) / 2} y={hy - 86} textAnchor="middle" fontFamily={sans} fontWeight={700} fontSize={24} letterSpacing={2.5} fill={palette.gold} stroke="rgba(0,0,0,0.8)" strokeWidth={5} style={{ paintOrder: "stroke" }}>
              COLUMN STRUNG OUT ALONG THE TRACK — NO ROOM TO DEPLOY A BATTLE LINE
            </text>
          </g>
        ) : null}

        {/* eagles lost */}
        {eagleScreens.map((e) => {
          const at0 = eagleTimes[e.legion];
          const o = prog(t, at0, at0 + 0.4) * (1 - after);
          if (o <= 0) return null;
          return (
            <g key={`eg${e.legion}`} opacity={o}>
              <circle cx={e.x} cy={e.y} r={26} fill="rgba(0,0,0,0.55)" stroke={palette.rome} strokeWidth={3} />
              <line x1={e.x - 15} y1={e.y - 15} x2={e.x + 15} y2={e.y + 15} stroke="#ff6b5e" strokeWidth={5} strokeLinecap="round" />
              <line x1={e.x - 15} y1={e.y + 15} x2={e.x + 15} y2={e.y - 15} stroke="#ff6b5e" strokeWidth={5} strokeLinecap="round" />
              <text x={e.x} y={e.y - 40} textAnchor="middle" fontFamily={sans} fontWeight={700} fontSize={24} letterSpacing={2} fill="#ffb4aa" stroke="rgba(0,0,0,0.85)" strokeWidth={5} style={{ paintOrder: "stroke" }}>
                {`LEGIO ${legNames[e.legion]}`}
              </text>
            </g>
          );
        })}
      </svg>

      {/* day sequence ticker */}
      {scene.days && scene.days.length ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center", gap: 26 }}>
          {scene.days.map((d, i) => {
            const o = prog(t, d.at, d.at + 0.4);
            const current = i === scene.days!.filter((x) => t >= x.at).length - 1;
            return (
              <div
                key={i}
                style={{
                  opacity: o,
                  transform: `translateY(${(1 - o) * 14}px)`,
                  padding: "12px 26px",
                  borderRadius: 4,
                  background: current ? palette.gold : "rgba(10,10,8,0.78)",
                  color: current ? palette.ink : palette.parchment,
                  border: `2px solid ${palette.gold}`,
                  fontFamily: sans,
                  fontWeight: 700,
                  fontSize: 30,
                  letterSpacing: 4,
                }}
              >
                {d.label}
              </div>
            );
          })}
        </div>
      ) : null}
      {(scene.notes ?? []).map((n, i) => {
        const o = Math.min(prog(t, n.at, n.at + 0.5), n.until !== undefined ? 1 - prog(t, n.until - 0.5, n.until) : 1);
        if (o <= 0) return null;
        return (
          <div
            key={`n${i}`}
            style={{
              position: "absolute",
              right: 60,
              top: 260,
              width: 560,
              padding: "14px 18px",
              background: "rgba(10,9,7,0.8)",
              borderLeft: `4px solid ${palette.gold}`,
              opacity: o,
              fontFamily: sans,
              color: palette.parchment,
            }}
          >
            {n.tag ? <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 2.5, color: palette.gold, marginBottom: 6 }}>{n.tag}</div> : null}
            <div style={{ fontSize: 22, lineHeight: 1.38 }}>{n.text}</div>
          </div>
        );
      })}

      {/* heading panel */}
      {heading && !scene.hideHeading ? (
        <div style={{ position: "absolute", top: 52, left: 60, maxWidth: 760, opacity: headingO * intro }}>
          <div style={{ display: "inline-block", fontFamily: sans, fontWeight: 700, fontSize: 16, letterSpacing: 3, color: palette.ink, background: palette.gold, padding: "5px 12px", borderRadius: 3 }}>
            {heading.tag}
          </div>
          <div style={{ marginTop: 10, fontFamily: serif, fontWeight: 700, fontSize: 44, color: palette.parchment, textShadow: "0 2px 14px rgba(0,0,0,0.9)" }}>
            {heading.text}
          </div>
          {heading.sub ? (
            <div style={{ marginTop: 6, fontFamily: sans, fontWeight: 500, fontSize: 22, color: palette.parchment, opacity: 0.9, textShadow: "0 2px 10px rgba(0,0,0,0.95)" }}>
              {heading.sub}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* legend */}
      <div
        style={{
          visibility: scene.hideHeading ? "hidden" : "visible",
          position: "absolute",
          top: 52,
          right: 60,
          padding: "12px 16px",
          background: "rgba(10,10,8,0.7)",
          borderRadius: 4,
          fontFamily: sans,
          fontSize: 17,
          color: palette.parchment,
          opacity: intro,
          display: "grid",
          gridTemplateColumns: "22px auto",
          rowGap: 6,
          columnGap: 10,
          alignItems: "center",
        }}
      >
        <svg width={18} height={14}><rect x={4} y={1} width={10} height={12} rx={2} fill={ROMAN} /></svg>
        <span>Legionaries</span>
        <svg width={18} height={14}><circle cx={9} cy={7} r={6} fill={AUX} /></svg>
        <span>Auxiliaries</span>
        <svg width={18} height={14}><ellipse cx={9} cy={7} rx={8} ry={4} fill={HORSE} /><circle cx={8} cy={7} r={3} fill={ROMAN} /></svg>
        <span>Cavalry</span>
        <svg width={18} height={14}><rect x={1} y={2} width={16} height={10} rx={2} fill={WAGON} /></svg>
        <span>Baggage & pack animals</span>
        <svg width={18} height={14}><circle cx={9} cy={7} r={6} fill={GERMAN} /></svg>
        <span>Germanic warriors</span>
      </div>

      {/* inset: why the legions could not deploy */}
      {insetO > 0 ? (
        <div
          style={{
            position: "absolute",
            right: 60,
            top: 250,
            width: 540,
            padding: "14px 18px 16px",
            background: "rgba(10,10,8,0.82)",
            border: `1px solid rgba(217,178,95,0.6)`,
            borderRadius: 4,
            opacity: insetO,
            fontFamily: sans,
            color: palette.parchment,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: 2.5, color: palette.gold }}>WHY A BATTLE LINE WAS HARD TO FORM</div>
          <svg width={504} height={170} viewBox="0 0 504 170" style={{ marginTop: 8 }}>
            {/* open field */}
            <rect x={0} y={0} width={240} height={128} fill="#3a3a26" rx={3} />
            {[0, 1, 2].map((row) =>
              Array.from({ length: row === 1 ? 4 : 5 }).map((_, c) => (
                <rect key={`o${row}-${c}`} x={(row === 1 ? 46 : 22) + c * 42} y={26 + row * 32} width={30} height={14} fill={ROMAN} rx={2} />
              )),
            )}
            <path d="M200 112 l10 10 l18 -22" stroke="#9fd18b" strokeWidth={4} fill="none" />
            <text x={120} y={152} textAnchor="middle" fontSize={15} fontWeight={700} fill={palette.parchment} letterSpacing={1.5}>
              OPEN FIELD: LINES IN DEPTH
            </text>
            {/* forest track */}
            <rect x={264} y={0} width={240} height={128} fill="#24301d" rx={3} />
            <rect x={264} y={52} width={240} height={24} fill="#6b5636" />
            {Array.from({ length: 16 }).map((_, k) => (
              <circle key={`tt${k}`} cx={276 + (k % 8) * 30} cy={k < 8 ? 24 : 104} r={12} fill="#33462a" />
            ))}
            {Array.from({ length: 22 }).map((_, k) => (
              <rect key={`col${k}`} x={270 + k * 10.5} y={60} width={7} height={8} fill={k % 7 === 5 ? WAGON : ROMAN} rx={1} />
            ))}
            <path d="M470 104 l20 20 M490 104 l-20 20" stroke="#ff6b5e" strokeWidth={4} />
            <text x={384} y={152} textAnchor="middle" fontSize={15} fontWeight={700} fill={palette.parchment} letterSpacing={1.5}>
              FOREST TRACK: THIN COLUMN
            </text>
          </svg>
        </div>
      ) : null}

      {scene.footnote && !scene.hideHeading ? (
        <div style={{ position: "absolute", left: 60, bottom: 18, fontFamily: sans, fontSize: 15, letterSpacing: 0.8, color: palette.parchment, opacity: 0.62 * intro }}>
          {scene.footnote}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
