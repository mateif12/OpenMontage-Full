import React from "react";
import { AbsoluteFill, Img, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset } from "../lib/resolveAsset";
import { FxSpec, GlobalFx } from "./types";

// Cinematic atmosphere drawn over a scene: drifting powder smoke, muzzle
// flashes (with the smoke puff they leave), embers, dust, light shafts and
// firelight flicker. Deterministic (seeded), and built only from gradients and
// transforms — no per-frame CSS filters — so it stays cheap to render.
// Effects are atmosphere over artwork/illustration; they never replace the
// image underneath and never add people, weapons or events.

const W = 1080;
const H = 1920;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const SmokeBank: React.FC<{ t: number; seed: string; amount: number; color: string }> = ({ t, seed, amount, color }) => {
  const n = Math.round(4 + amount * 10);
  return (
    <>
      {Array.from({ length: n }).map((_, i) => {
        const r = (k: string) => random(`${seed}-${i}-${k}`);
        const size = 520 + r("s") * 900;
        const speed = 10 + r("v") * 26; // px/s
        const baseX = r("x") * (W + size) - size / 2;
        const x = ((baseX + t * speed) % (W + size)) - size / 2;
        const y = H * (0.2 + r("y") * 0.65) - size / 2 + Math.sin(t * 0.3 + r("p") * 6) * 30;
        const grow = 1 + 0.08 * Math.sin(t * 0.2 + r("g") * 6);
        const alpha = (0.1 + r("a") * 0.16) * amount;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size * 0.62,
              borderRadius: "50%",
              transform: `scale(${grow})`,
              background: `radial-gradient(ellipse at 50% 50%, ${color.replace("A", String(alpha))} 0%, ${color.replace(
                "A",
                String(alpha * 0.55),
              )} 38%, rgba(0,0,0,0) 70%)`,
            }}
          />
        );
      })}
    </>
  );
};

const Flash: React.FC<{ t: number; at: number; x: number; y: number; size: number; smoke: boolean; color: string }> = ({
  t,
  at,
  x,
  y,
  size,
  smoke,
  color,
}) => {
  const dt = t - at;
  if (dt < -0.05 || dt > 6) return null;
  const flash = dt < 0 ? 0 : dt < 0.06 ? dt / 0.06 : Math.exp(-(dt - 0.06) / 0.12);
  const puffA = smoke ? clamp01(dt / 0.25) * Math.exp(-dt / 3.2) * 0.55 : 0;
  const puffR = size * (0.5 + 1.6 * (1 - Math.exp(-dt / 1.2)));
  const cx = x * W;
  const cy = y * H;
  return (
    <>
      {puffA > 0.01 ? (
        <div
          style={{
            position: "absolute",
            left: cx - puffR + dt * 18,
            top: cy - puffR * 0.75 - dt * 14,
            width: puffR * 2,
            height: puffR * 1.5,
            borderRadius: "50%",
            background: `radial-gradient(ellipse at 50% 55%, ${color.replace("A", String(puffA))} 0%, ${color.replace(
              "A",
              String(puffA * 0.5),
            )} 45%, rgba(0,0,0,0) 72%)`,
          }}
        />
      ) : null}
      {flash > 0.01 ? (
        <>
          <div
            style={{
              position: "absolute",
              left: cx - size,
              top: cy - size,
              width: size * 2,
              height: size * 2,
              borderRadius: "50%",
              mixBlendMode: "screen",
              background: `radial-gradient(circle, rgba(255,246,214,${flash}) 0%, rgba(255,190,90,${
                flash * 0.75
              }) 18%, rgba(255,120,40,${flash * 0.3}) 42%, rgba(0,0,0,0) 70%)`,
            }}
          />
          <AbsoluteFill style={{ backgroundColor: `rgba(255,214,150,${flash * 0.1})`, mixBlendMode: "screen" }} />
        </>
      ) : null}
    </>
  );
};

const Particles: React.FC<{ t: number; seed: string; amount: number; kind: "embers" | "dust" }> = ({
  t,
  seed,
  amount,
  kind,
}) => {
  const n = Math.round((kind === "embers" ? 60 : 45) * amount);
  return (
    <>
      {Array.from({ length: n }).map((_, i) => {
        const r = (k: string) => random(`${seed}-${kind}-${i}-${k}`);
        const life = kind === "embers" ? 3 + r("l") * 3 : 8 + r("l") * 6;
        const phase = ((t + r("o") * life) % life) / life;
        const x0 = r("x") * W;
        const sway = Math.sin((t + r("w") * 10) * (kind === "embers" ? 2.2 : 0.6)) * (kind === "embers" ? 26 : 40);
        const x = x0 + sway + (kind === "dust" ? phase * 80 : 0);
        const y =
          kind === "embers" ? H * (0.95 - phase * (0.55 + r("h") * 0.4)) : H * (0.1 + r("y") * 0.8) - phase * 60;
        const s = kind === "embers" ? 3 + r("s") * 5 : 2 + r("s") * 3;
        const fade = Math.sin(Math.PI * phase);
        const flick = kind === "embers" ? 0.6 + 0.4 * Math.sin(t * 18 + i) : 1;
        const a = fade * flick * (kind === "embers" ? 0.95 : 0.35);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: s,
              height: s,
              borderRadius: "50%",
              background: kind === "embers" ? `rgba(255,${150 + Math.round(r("c") * 70)},60,${a})` : `rgba(240,230,205,${a})`,
              boxShadow: kind === "embers" ? `0 0 ${s * 3}px rgba(255,140,40,${a * 0.8})` : undefined,
            }}
          />
        );
      })}
    </>
  );
};

export const FxLayer: React.FC<{ fx: FxSpec; sceneId: string; sceneStart: number }> = ({ fx, sceneId, sceneStart }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = sceneStart + frame / fps; // absolute narration time
  const smokeColor = fx.smokeColor ?? "rgba(214,208,192,A)";
  const flicker = fx.flicker
    ? fx.flicker * (0.5 + 0.5 * Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1) + 0.25 * random(`fl-${Math.floor(t * 12)}`))
    : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {fx.rays ? (
        <AbsoluteFill
          style={{
            opacity: fx.rays * (0.55 + 0.15 * Math.sin(t * 0.7)),
            mixBlendMode: "screen",
            background:
              "repeating-linear-gradient(105deg, rgba(255,236,190,0) 0px, rgba(255,236,190,0.10) 60px, rgba(255,236,190,0) 150px)",
            maskImage: "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0) 80%)",
            WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0) 80%)",
          }}
        />
      ) : null}
      {fx.smoke ? <SmokeBank t={t} seed={sceneId} amount={fx.smoke} color={smokeColor} /> : null}
      {(fx.flashes ?? []).map((f, i) => (
        <Flash
          key={i}
          t={t}
          at={f.t}
          x={f.x}
          y={f.y}
          size={f.size ?? 220}
          smoke={f.smoke ?? true}
          color={smokeColor}
        />
      ))}
      {fx.embers ? <Particles t={t} seed={sceneId} amount={fx.embers} kind="embers" /> : null}
      {fx.dust ? <Particles t={t} seed={sceneId} amount={fx.dust} kind="dust" /> : null}
      {flicker > 0 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(255,170,90,${flicker * 0.08})`, mixBlendMode: "screen" }} />
      ) : null}
    </AbsoluteFill>
  );
};

// Film grain over the whole Short (tiles pre-rendered by build_props.py).
export const GrainLayer: React.FC<{ fx: GlobalFx }> = ({ fx }) => {
  const frame = useCurrentFrame();
  const srcs = fx.grainSrcs ?? [];
  const amount = fx.grain ?? 0.5;
  if (!srcs.length || amount <= 0) return null;
  const src = srcs[frame % srcs.length];
  const ox = Math.floor(random(`gx-${frame}`) * 200);
  const oy = Math.floor(random(`gy-${frame}`) * 200);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden", opacity: interpolate(amount, [0, 1], [0, 0.16]) }}>
      <Img
        src={resolveAsset(src)}
        style={{ position: "absolute", left: -ox, top: -oy, width: W + 200, height: H + 200, mixBlendMode: "overlay" }}
      />
    </AbsoluteFill>
  );
};
