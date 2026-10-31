import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { palette, sans, serif } from "../historical-short/theme";
import { LegionsScene, ProfileCard, ProfilesScene } from "./types";

// Original typographic scenes used where no authentic image is available.
// Emblems are GENERIC symbols (a legionary standard, a wooden shield) —
// never portraits or reconstructions of specific objects.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.out(Easing.cubic);
const fade = (t: number, at: number, d = 0.5) => interpolate(t, [at, at + d], [0, 1], { ...clamp, easing: ease });

const Backdrop: React.FC<{ t: number; start: number }> = ({ t, start }) => {
  const drift = (t - start) * 6;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, #2a2419 0%, #14110c 70%, #0b0a07 100%)" }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
        <defs>
          <pattern id="cardgrid" width={64} height={64} patternUnits="userSpaceOnUse" patternTransform={`translate(${drift} 0)`}>
            <path d="M64 0H0V64" fill="none" stroke="rgba(241,230,204,0.05)" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={1920} height={1080} fill="url(#cardgrid)" />
      </svg>
    </AbsoluteFill>
  );
};

export const RomanStandard: React.FC<{ size: number; color?: string; struck?: number }> = ({ size, color = palette.gold, struck = 0 }) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 100 130">
    <line x1={50} y1={40} x2={50} y2={128} stroke={color} strokeWidth={4} />
    <rect x={36} y={60} width={28} height={6} fill={color} />
    {/* stylised bird with raised wings on a plinth — generic emblem */}
    <rect x={40} y={34} width={20} height={6} rx={1} fill={color} />
    <path d="M50 30 C44 26 40 18 30 8 C38 10 44 16 47 22 L50 14 L53 22 C56 16 62 10 70 8 C60 18 56 26 50 30 Z" fill={color} />
    <circle cx={50} cy={15} r={3.5} fill={color} />
    {struck > 0 ? (
      <g stroke="#ff6b5e" strokeWidth={6} strokeLinecap="round" opacity={struck}>
        <line x1={18} y1={24 + (1 - struck) * 40} x2={18 + 64 * struck} y2={24 + 80 * struck} />
      </g>
    ) : null}
  </svg>
);

const GermanicShield: React.FC<{ size: number; color?: string }> = ({ size, color = palette.gold }) => (
  <svg width={size} height={size * 1.3} viewBox="0 0 100 130">
    <ellipse cx={50} cy={66} rx={38} ry={52} fill="none" stroke={color} strokeWidth={5} />
    {[-24, -12, 0, 12, 24].map((x) => (
      <line key={x} x1={50 + x} y1={66 - Math.sqrt(Math.max(0, 1 - (x / 38) ** 2)) * 50} x2={50 + x} y2={66 + Math.sqrt(Math.max(0, 1 - (x / 38) ** 2)) * 50} stroke={color} strokeWidth={1.5} opacity={0.6} />
    ))}
    <circle cx={50} cy={66} r={12} fill={color} />
  </svg>
);

const Card: React.FC<{ card: ProfileCard; t: number; x: number; fromLeft: boolean }> = ({ card, t, x, fromLeft }) => {
  const o = fade(t, card.at, 0.6);
  const dx = interpolate(o, [0, 1], [fromLeft ? -40 : 40, 0]);
  const fo = fade(t, card.factsAt ?? card.at + 0.6, 0.5);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 190,
        width: 640,
        opacity: o,
        transform: `translateX(${dx}px)`,
        padding: "30px 36px 30px",
        background: "rgba(12,11,8,0.72)",
        border: "1px solid rgba(217,178,95,0.45)",
        borderRadius: 6,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        {card.emblem === "roman-standard" ? <RomanStandard size={92} /> : <GermanicShield size={92} />}
        <div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 18, letterSpacing: 3, color: palette.gold }}>{card.role}</div>
          <div style={{ marginTop: 8, fontFamily: serif, fontWeight: 700, fontSize: 50, lineHeight: 1.05, color: palette.parchment }}>{card.name}</div>
        </div>
      </div>
      <div style={{ marginTop: 24, opacity: fo }}>
        {card.facts.map((f, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 14,
              fontFamily: sans,
              fontSize: 25,
              lineHeight: 1.35,
              color: palette.parchment,
              marginTop: 10,
              opacity: fade(t, (card.factsAt ?? card.at + 0.6) + i * 0.25, 0.4),
            }}
          >
            <span style={{ color: palette.gold }}>—</span>
            <span>{f}</span>
          </div>
        ))}
        <div style={{ marginTop: 18, fontFamily: serif, fontStyle: "italic", fontSize: 19, color: palette.parchment, opacity: 0.7 }}>{card.source}</div>
      </div>
    </div>
  );
};

const Footnote: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <div style={{ position: "absolute", left: 60, bottom: 18, fontFamily: sans, fontSize: 15, letterSpacing: 0.8, color: palette.parchment, opacity: 0.6 }}>{text}</div>
  ) : null;

export const ProfilesView: React.FC<{ scene: ProfilesScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const lp = interpolate(t, [scene.link.at, scene.link.at + 0.7], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop t={t} start={scene.start} />
      <Card card={scene.left} t={t} x={150} fromLeft />
      <Card card={scene.right} t={t} x={1130} fromLeft={false} />
      {/* link */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <g opacity={lp}>
          <line x1={850} y1={330} x2={850 + 250 * lp} y2={330} stroke={palette.gold} strokeWidth={4} />
          <polygon points={`${862 + 250 * lp},330 ${846 + 250 * lp},320 ${846 + 250 * lp},340`} fill={palette.gold} />
          <text x={975} y={312} textAnchor="middle" fontFamily={sans} fontWeight={700} fontSize={22} letterSpacing={4} fill={palette.gold}>
            {scene.link.text}
          </text>
        </g>
      </svg>
      <Footnote text={scene.footnote} />
    </AbsoluteFill>
  );
};

export const LegionsView: React.FC<{ scene: LegionsScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const struck = interpolate(t, [scene.struckAt, scene.struckAt + 0.6], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop t={t} start={scene.start} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          paddingTop: 120,
          transform: `scale(${interpolate(t, [scene.start, scene.end + 0.5], [1, 1.045], clamp)})`,
        }}
      >
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 64, color: palette.parchment, opacity: fade(t, scene.start + 0.1, 0.6) }}>{scene.heading}</div>
        <div style={{ display: "flex", gap: 150, marginTop: 50 }}>
          {scene.legions.map((l, i) => {
            const o = fade(t, l.at, 0.5);
            const s = Math.max(0, Math.min(1, struck * 1.4 - i * 0.2));
            return (
              <div key={l.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: o, transform: `translateY(${(1 - o) * 30}px)` }}>
                <RomanStandard size={150} color={s > 0.5 ? "#8c6a3a" : palette.gold} struck={s} />
                <div style={{ marginTop: 18, fontFamily: sans, fontWeight: 700, fontSize: 40, letterSpacing: 6, color: s > 0.5 ? "#ff9d92" : palette.parchment }}>{l.name}</div>
              </div>
            );
          })}
        </div>
        {scene.note ? (
          <div
            style={{
              marginTop: 50,
              maxWidth: 1180,
              textAlign: "center",
              fontFamily: sans,
              fontSize: 26,
              lineHeight: 1.4,
              color: palette.parchment,
              opacity: 0.9 * fade(t, scene.note.at, 0.6),
            }}
          >
            {scene.note.text}
          </div>
        ) : null}
      </AbsoluteFill>
      <Footnote text={scene.footnote} />
    </AbsoluteFill>
  );
};
