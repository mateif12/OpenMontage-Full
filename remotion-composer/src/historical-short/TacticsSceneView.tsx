import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { TacticsScene } from "./types";
import { palette, sans } from "./theme";

// Original schematic of a double envelopment (Cannae-type battle). Positions
// are deliberately simplified; the scene label must say "schematic / not to
// scale". Phase timings come from the narration (episode.yaml).

const ease = Easing.inOut(Easing.cubic);
const prog = (t: number, [a, b]: [number, number]) =>
  interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

const Block: React.FC<{
  cx: number;
  cy: number;
  cols: number;
  rows: number;
  pip?: number;
  gap?: number;
  color: string;
  scaleX?: number;
  opacity?: number;
  shape?: "square" | "diamond";
}> = ({ cx, cy, cols, rows, pip = 20, gap = 8, color, scaleX = 1, opacity = 1, shape = "square" }) => {
  const step = pip + gap;
  const w = cols * step - gap;
  const h = rows * step - gap;
  const pips = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx + (c * step - w / 2) * scaleX;
      const y = cy + r * step - h / 2;
      pips.push(
        shape === "diamond" ? (
          <rect
            key={`${r}-${c}`}
            x={x}
            y={y}
            width={pip * 0.78}
            height={pip * 0.78}
            transform={`rotate(45 ${x + pip / 2} ${y + pip / 2})`}
            fill={color}
            rx={2}
          />
        ) : (
          <rect key={`${r}-${c}`} x={x} y={y} width={pip * scaleX} height={pip} fill={color} rx={3} />
        ),
      );
    }
  }
  return <g opacity={opacity}>{pips}</g>;
};

const Arrow: React.FC<{ x1: number; y1: number; x2: number; y2: number; color: string; p: number; width?: number }> = ({
  x1,
  y1,
  x2,
  y2,
  color,
  p,
  width = 10,
}) => {
  if (p <= 0) return null;
  const x = lerp(x1, x2, p);
  const y = lerp(y1, y2, p);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const hl = width * 2.6;
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  return (
    <g opacity={Math.min(1, p * 3)}>
      <line x1={x1} y1={y1} x2={x} y2={y} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon
        points={`${x + Math.cos(ang) * hl * 0.4},${y + Math.sin(ang) * hl * 0.4} ${x + Math.cos(a1) * hl},${y + Math.sin(a1) * hl} ${x + Math.cos(a2) * hl},${y + Math.sin(a2) * hl}`}
        fill={color}
      />
    </g>
  );
};

const Label: React.FC<{ x: number; y: number; text: string; color: string; opacity: number; size?: number }> = ({
  x,
  y,
  text,
  color,
  opacity,
  size = 28,
}) => (
  <text
    x={x}
    y={y}
    textAnchor="middle"
    fontFamily={sans}
    fontWeight={700}
    fontSize={size}
    letterSpacing={3}
    fill={color}
    opacity={opacity}
    stroke="rgba(0,0,0,0.7)"
    strokeWidth={6}
    style={{ paintOrder: "stroke" }}
  >
    {text}
  </text>
);

const quad = (p: number, a: [number, number], c: [number, number], b: [number, number]): [number, number] => {
  const q = 1 - p;
  return [q * q * a[0] + 2 * q * p * c[0] + p * p * b[0], q * q * a[1] + 2 * q * p * c[1] + p * p * b[1]];
};

export const TacticsSceneView: React.FC<{ scene: TacticsScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const T = scene.times;

  const intro = interpolate(t, [scene.start, scene.start + 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const back = prog(t, T.centreBack);
  const adv = prog(t, T.advance);
  const wheel = prog(t, T.wheel);
  const cav = prog(t, T.cavalry);
  const trapped = interpolate(t, [T.trapped, T.trapped + 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Roman block
  const romanCy = lerp(560, 760, adv);
  const romanScaleX = lerp(1, 0.84, adv);
  const romanHalfW = 240 * romanScaleX;

  // Carthaginian centre crescent: bow > 0 bulges toward the Romans
  const bow = lerp(lerp(110, -50, back), -115, adv);
  const crescent = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const x = lerp(300, 780, i / (N - 1));
    const nx = (x - 540) / 240;
    const y = 840 - bow * (1 - nx * nx);
    crescent.push(<rect key={i} x={x - 19} y={y - 13} width={38} height={26} rx={4} fill={palette.carthage} />);
  }

  // African infantry on the flanks -> close in on the Roman sides
  const afrY = lerp(870, 770, wheel);
  const afrLx = lerp(210, 540 - romanHalfW - 72, wheel);
  const afrRx = lerp(870, 540 + romanHalfW + 72, wheel);

  // Cavalry from both wings round to the Roman rear
  const romanRear = romanCy - 120;
  const cavL = quad(cav, [78, 900], [40, 330], [430, romanRear - 50]);
  const cavR = quad(cav, [1002, 900], [1040, 330], [650, romanRear - 50]);

  const flank = scene.times.flankHighlight ? prog(t, scene.times.flankHighlight) : 0;
  const flankFade = scene.times.flankHighlight
    ? interpolate(t, [scene.times.flankHighlight[1], scene.times.flankHighlight[1] + 0.8], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const pulse = 0.55 + 0.45 * Math.sin((t - T.trapped) * 5);
  const romanColor = trapped > 0 ? "#9e2a22" : palette.rome;

  return (
    <AbsoluteFill style={{ backgroundColor: "#15120d" }}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920">
        <defs>
          <radialGradient id="field" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#2a2418" />
            <stop offset="100%" stopColor="#100d09" />
          </radialGradient>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M60 0H0V60" fill="none" stroke={palette.grid} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={1080} height={1920} fill="url(#field)" />
        <rect width={1080} height={1920} fill="url(#grid)" />

        <g opacity={intro}>
          {/* flank highlight */}
          {flank > 0 ? (
            <g opacity={flank * flankFade}>
              <rect x={afrLx - 84} y={afrY - 128} width={168} height={256} rx={14} fill="none" stroke={palette.gold} strokeWidth={4} strokeDasharray="12 10" />
              <rect x={afrRx - 84} y={afrY - 128} width={168} height={256} rx={14} fill="none" stroke={palette.gold} strokeWidth={4} strokeDasharray="12 10" />
            </g>
          ) : null}

          <Block cx={540} cy={romanCy} cols={16} rows={7} color={romanColor} scaleX={romanScaleX} />
          {crescent}
          <Block cx={afrLx} cy={afrY} cols={4} rows={7} color={palette.carthageDark} />
          <Block cx={afrRx} cy={afrY} cols={4} rows={7} color={palette.carthageDark} />

          {/* cavalry trails */}
          {cav > 0 ? (
            <g opacity={0.55}>
              {[0, 1].map((side) => {
                const pts = [];
                for (let k = 0; k <= 24; k++) {
                  const pp = (k / 24) * cav;
                  pts.push(side === 0 ? quad(pp, [78, 900], [40, 330], [430, romanRear - 50]) : quad(pp, [1002, 900], [1040, 330], [650, romanRear - 50]));
                }
                return (
                  <polyline
                    key={side}
                    points={pts.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={palette.gold}
                    strokeWidth={5}
                    strokeDasharray="14 12"
                  />
                );
              })}
            </g>
          ) : null}
          <Block cx={cavL[0]} cy={cavL[1]} cols={3} rows={4} pip={18} gap={9} color={palette.gold} shape="diamond" />
          <Block cx={cavR[0]} cy={cavR[1]} cols={3} rows={4} pip={18} gap={9} color={palette.gold} shape="diamond" />

          {/* movement arrows */}
          {[-150, 0, 150].map((dx) => (
            <Arrow
              key={dx}
              x1={540 + dx}
              y1={840 - 110 * (1 - (dx / 240) ** 2) + 30}
              x2={540 + dx}
              y2={840 - 110 * (1 - (dx / 240) ** 2) + 110}
              color={palette.parchment}
              width={6}
              p={back * (1 - adv)}
            />
          ))}
          <Arrow x1={540} y1={420} x2={540} y2={600} color="#ff6b5e" width={12} p={adv * (1 - wheel)} />
          <Arrow x1={afrLx - 90} y1={afrY} x2={afrLx + 20} y2={afrY} color={palette.gold} width={10} p={wheel * (1 - cav)} />
          <Arrow x1={afrRx + 90} y1={afrY} x2={afrRx - 20} y2={afrY} color={palette.gold} width={10} p={wheel * (1 - cav)} />

          {/* encirclement */}
          {trapped > 0 ? (
            <ellipse
              cx={540}
              cy={romanCy}
              rx={romanHalfW + 175}
              ry={215}
              fill="none"
              stroke={palette.gold}
              strokeWidth={6}
              strokeDasharray="22 14"
              opacity={trapped * pulse}
            />
          ) : null}

          {/* labels */}
          <Label x={540} y={romanCy - 130} text="ROMAN ARMY" color="#ff8a7e" opacity={1 - wheel} />
          <Label x={540} y={840 - bow + 92} text="GAULS & IBERIANS" color={palette.gold} opacity={1 - wheel} size={26} />
          <Label x={afrLx} y={afrY + 150} text="AFRICANS" color={palette.gold} opacity={1 - cav} size={24} />
          <Label x={afrRx} y={afrY + 150} text="AFRICANS" color={palette.gold} opacity={1 - cav} size={24} />
          <Label x={cavL[0] + 10} y={cav > 0.5 ? cavL[1] - 64 : cavL[1] + 78} text="CAVALRY" color={palette.gold} opacity={interpolate(cav, [0, 0.15, 0.85, 1], [1, 0, 0, 1])} size={22} />
          <Label x={cavR[0] - 10} y={cav > 0.5 ? cavR[1] - 64 : cavR[1] + 78} text="CAVALRY" color={palette.gold} opacity={interpolate(cav, [0, 0.15, 0.85, 1], [1, 0, 0, 1])} size={22} />
          <Label x={540} y={romanCy + 6} text="SURROUNDED" color={palette.parchment} opacity={trapped} size={40} />
        </g>

        {/* legend */}
        <g opacity={intro} transform="translate(250 1110)">
          <rect x={0} y={-20} width={26} height={26} rx={4} fill={palette.rome} />
          <text x={40} y={2} fontFamily={sans} fontWeight={500} fontSize={26} fill={palette.parchment}>
            Rome
          </text>
          <rect x={190} y={-20} width={26} height={26} rx={4} fill={palette.carthage} />
          <text x={230} y={2} fontFamily={sans} fontWeight={500} fontSize={26} fill={palette.parchment}>
            Hannibal's army
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
