import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { IllustrationScene } from "./types";
import { palette, sans } from "./theme";

// Original illustration: two armies facing each other across a plain at dusk.
// Figures are deliberately generic silhouettes (round shield + spear), never a
// reconstruction of specific equipment. The scene label must say
// "ORIGINAL ILLUSTRATION".

const W = 1080;
const H = 1920;
const HORIZON = 900;

const ridge = (seed: string, base: number, amp: number, freq: number, shift: number) => {
  const pts: string[] = [`M -100 ${H}`];
  for (let x = -100; x <= W + 100; x += 20) {
    const xx = x + shift;
    const y =
      base -
      amp * (0.55 * Math.sin(xx * freq + random(seed) * 6) + 0.3 * Math.sin(xx * freq * 2.3 + random(seed + "b") * 6) + 0.15 * Math.sin(xx * freq * 5.1));
    pts.push(`L ${x} ${y.toFixed(1)}`);
  }
  pts.push(`L ${W + 100} ${H} Z`);
  return pts.join(" ");
};

// One soldier silhouette, feet at (x, y), height h.
const Figure: React.FC<{ x: number; y: number; h: number; color: string; facing: 1 | -1; sway: number }> = ({
  x,
  y,
  h,
  color,
  facing,
  sway,
}) => {
  const w = h * 0.32;
  return (
    <g transform={`translate(${x} ${y}) scale(${facing} 1)`}>
      {/* spear */}
      <line x1={w * 0.55} y1={-h * 1.35 + sway} x2={w * 0.45} y2={-h * 0.05} stroke={color} strokeWidth={Math.max(1, h * 0.035)} />
      {/* legs + body */}
      <path
        d={`M ${-w * 0.25} 0 L ${-w * 0.1} ${-h * 0.42} L ${w * 0.1} ${-h * 0.42} L ${w * 0.25} 0 Z`}
        fill={color}
      />
      <rect x={-w * 0.28} y={-h * 0.82} width={w * 0.56} height={h * 0.44} rx={w * 0.12} fill={color} />
      {/* head */}
      <circle cx={0} cy={-h * 0.9} r={h * 0.1} fill={color} />
      {/* round shield */}
      <ellipse cx={w * 0.32} cy={-h * 0.58} rx={w * 0.42} ry={h * 0.24} fill={color} />
    </g>
  );
};

const Army: React.FC<{
  side: "left" | "right";
  rows: number;
  perRow: number;
  color: string;
  t: number;
  seed: string;
}> = ({ side, rows, perRow, color, t, seed }) => {
  const figs = [];
  for (let r = rows - 1; r >= 0; r--) {
    const depth = r / Math.max(1, rows - 1); // 0 front .. 1 back
    const y = interpolate(depth, [0, 1], [1230, HORIZON + 60]);
    const h = interpolate(depth, [0, 1], [135, 32]);
    // each army keeps to its own half; a gap (no man's land) narrows with depth
    const gap = interpolate(depth, [0, 1], [150, 60]);
    const inner = side === "left" ? W / 2 - gap / 2 : W / 2 + gap / 2;
    const outer = side === "left" ? interpolate(depth, [0, 1], [-70, 60]) : W - interpolate(depth, [0, 1], [-70, 60]);
    const spacing = Math.abs(inner - outer) / perRow;
    const x0 = Math.min(inner, outer) + spacing / 2;
    for (let i = 0; i < perRow; i++) {
      const jitter = (random(`${seed}-${r}-${i}`) - 0.5) * spacing * 0.5;
      const x = x0 + i * spacing + jitter;
      const sway = Math.sin(t * 1.4 + i * 0.7 + r) * h * 0.03;
      const shade = interpolate(depth, [0, 1], [1, 0.45]);
      figs.push(
        <g key={`${r}-${i}`} opacity={shade}>
          <Figure x={x} y={y} h={h} color={color} facing={side === "left" ? 1 : -1} sway={sway} />
        </g>,
      );
    }
  }
  return <g>{figs}</g>;
};

// Aftermath: abandoned round shields and broken spears on the plain, drifting
// smoke. Deliberately shows no bodies and no specific equipment.
const Debris: React.FC<{ t: number; count: number }> = ({ t, count }) => {
  const items = [];
  // draw far items first so nearer ones overlap them
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => random(`d-depth-${b}`) - random(`d-depth-${a}`),
  );
  for (const i of order) {
    const depth = random(`d-depth-${i}`); // 0 front .. 1 back
    const y = interpolate(depth ** 0.8, [0, 1], [1620, HORIZON + 30]);
    const s = interpolate(depth, [0, 1], [1.35, 0.22]);
    const x = random(`d-x-${i}`) * (W + 200) - 100;
    const kind = random(`d-k-${i}`);
    const shade = interpolate(depth, [0, 1], [1, 0.5]);
    if (kind < 0.45) {
      // shield lying on the ground (flattened ellipse with rim + boss)
      const r = 70 * s;
      items.push(
        <g key={i} opacity={shade} transform={`translate(${x} ${y}) rotate(${(random(`d-r-${i}`) - 0.5) * 30})`}>
          <ellipse cx={0} cy={0} rx={r} ry={r * 0.32} fill="#1f160e" stroke="#8a6a3e" strokeWidth={3.5 * s} />
          <ellipse cx={0} cy={-r * 0.03} rx={r * 0.2} ry={r * 0.08} fill="#2a1d12" />
        </g>,
      );
    } else {
      // spear shaft stuck in the ground at an angle (some broken)
      const len = (120 + random(`d-l-${i}`) * 140) * s * (kind > 0.8 ? 0.5 : 1);
      const ang = (random(`d-a-${i}`) - 0.5) * 70;
      items.push(
        <g key={i} opacity={shade} transform={`translate(${x} ${y}) rotate(${ang})`}>
          <line x1={0} y1={0} x2={0} y2={-len} stroke="#140d08" strokeWidth={Math.max(1.5, 6 * s)} strokeLinecap="round" />
          {kind <= 0.8 ? <path d={`M ${-6 * s} ${-len} L 0 ${-len - 26 * s} L ${6 * s} ${-len} Z`} fill="#140d08" /> : null}
        </g>,
      );
    }
  }
  const smoke = [0, 1, 2, 3].map((k) => {
    const x0 = 160 + k * 250;
    const rise = ((t * 18 + k * 90) % 420);
    return (
      <circle
        key={`s${k}`}
        cx={x0 + Math.sin(t * 0.3 + k) * 30}
        cy={HORIZON + 30 - rise}
        r={90 + rise * 0.35}
        fill="#3a2e26"
        opacity={0.28 * (1 - rise / 420)}
        style={{ filter: "blur(24px)" }}
      />
    );
  });
  return (
    <g>
      {smoke}
      {items}
    </g>
  );
};

export const IllustrationSceneView: React.FC<{ scene: IllustrationScene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const p = frame / Math.max(1, durationInFrames);
  const push = interpolate(p, [0, 1], [1.0, 1.08]);
  const drift = interpolate(p, [0, 1], [0, -40]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0b09", overflow: "hidden" }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ transform: `scale(${push})`, transformOrigin: "50% 55%" }}
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#120f12" />
            <stop offset="45%" stopColor="#3a2a22" />
            <stop offset="62%" stopColor="#a8683a" />
            <stop offset="72%" stopColor="#d9a35c" />
          </linearGradient>
          <radialGradient id="sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffe2a8" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#f0b86a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f0b86a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="plain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a4127" />
            <stop offset="100%" stopColor="#140f0a" />
          </linearGradient>
          <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d9a35c" stopOpacity="0" />
            <stop offset="50%" stopColor="#d9a35c" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#d9a35c" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#sky)" />
        <circle cx={540} cy={HORIZON - 40} r={260} fill="url(#sun)" />
        <path d={ridge("far", HORIZON - 30, 40, 0.006, drift * 0.3)} fill="#4a3426" opacity={0.85} />
        <path d={ridge("mid", HORIZON + 10, 28, 0.009, drift * 0.6)} fill="#2e2219" />
        <rect x={0} y={HORIZON + 20} width={W} height={H - HORIZON} fill="url(#plain)" />
        <rect x={0} y={HORIZON - 80} width={W} height={260} fill="url(#haze)" transform={`translate(${drift * 0.8} 0)`} />

        {scene.variant === "aftermath" ? (
          <>
            <rect width={W} height={H} fill="#1a0b08" opacity={0.28} />
            <Debris t={t} count={85} />
          </>
        ) : (
          <>
            <Army side="left" rows={scene.leftRows ?? 9} perRow={scene.leftPerRow ?? 14} color="#170d0b" t={t} seed="L" />
            <Army side="right" rows={scene.rightRows ?? 6} perRow={scene.rightPerRow ?? 9} color="#1c140c" t={t} seed="R" />
          </>
        )}

        {/* foreground dust */}
        <rect x={0} y={1250} width={W} height={300} fill="url(#haze)" opacity={0.7} transform={`translate(${-drift} 0)`} />
      </svg>

      {scene.leftLabel ? (
        <div style={{ position: "absolute", left: 60, top: 850, fontFamily: sans, fontWeight: 700, fontSize: 30, letterSpacing: 4, color: "#ff8a7e", textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>
          {scene.leftLabel}
        </div>
      ) : null}
      {scene.rightLabel ? (
        <div style={{ position: "absolute", right: 150, top: 850, fontFamily: sans, fontWeight: 700, fontSize: 30, letterSpacing: 4, color: palette.gold, textShadow: "0 2px 10px rgba(0,0,0,0.9)", textAlign: "right" }}>
          {scene.rightLabel}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
