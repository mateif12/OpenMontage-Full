import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { resolveAsset } from "../lib/resolveAsset";
import { MapCameraKey, MapMarker, MapScene } from "./types";
import { palette, sans, serif } from "./theme";

interface Basemap {
  kx: number;
  land: string[];
  lakes: string[];
}

const W = 1080;
const H = 1920;

const useBasemap = (src: string): Basemap | null => {
  const [data, setData] = useState<Basemap | null>(null);
  const [handle] = useState(() => delayRender(`Loading basemap ${src}`));
  useEffect(() => {
    fetch(resolveAsset(src))
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(new Error(`Basemap ${src} failed: ${err}`)));
  }, [src, handle]);
  return data;
};

const cameraAt = (keys: MapCameraKey[], t: number): MapCameraKey => {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const p = Easing.inOut(Easing.cubic)((t - a.t) / Math.max(0.001, b.t - a.t));
      // interpolate span geometrically so zooms feel uniform
      const span = Math.exp(Math.log(a.span) + (Math.log(b.span) - Math.log(a.span)) * p);
      return { t, lon: a.lon + (b.lon - a.lon) * p, lat: a.lat + (b.lat - a.lat) * p, span };
    }
  }
  return keys[keys.length - 1];
};

const fadeIn = (t: number, at: number, dur = 0.5) =>
  interpolate(t, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const MapSceneView: React.FC<{ scene: MapScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps; // absolute narration time
  const base = useBasemap(scene.basemap);
  if (!base) return <AbsoluteFill style={{ backgroundColor: palette.sea }} />;

  const kx = base.kx;
  const cam = cameraAt(scene.camera, t);
  const vbW = cam.span * kx;
  const vbH = (vbW * H) / W;
  const cx = cam.lon * kx;
  const cy = -cam.lat;
  const u = vbW / W; // map units per screen pixel
  const proj = (lon: number, lat: number): [number, number] => [lon * kx, -lat];

  const markerColor = (m: MapMarker) =>
    m.style === "capital-rome" || m.style === "battle"
      ? palette.rome
      : m.style === "capital-carthage"
        ? palette.carthage
        : palette.parchment;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.seaDeep }}>
      <svg width={W} height={H} viewBox={`${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`}>
        <defs>
          <radialGradient id="seaGlow" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor={palette.sea} />
            <stop offset="100%" stopColor={palette.seaDeep} />
          </radialGradient>
        </defs>
        <rect x={cx - vbW} y={cy - vbH} width={vbW * 2} height={vbH * 2} fill="url(#seaGlow)" />
        {base.land.map((d, i) => (
          <path
            key={`l${i}`}
            d={d}
            fill={palette.land}
            stroke={palette.landEdge}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {base.lakes.map((d, i) => (
          <path key={`k${i}`} d={d} fill={palette.sea} stroke="none" />
        ))}

        {(scene.texts ?? []).map((tx, i) => {
          const [x, y] = proj(tx.lon, tx.lat);
          return (
            <text
              key={`t${i}`}
              x={x}
              y={y}
              textAnchor="middle"
              fontFamily={serif}
              fontWeight={700}
              fontSize={(tx.size ?? 34) * u}
              letterSpacing={4 * u}
              fill={tx.color ?? palette.parchment}
              opacity={fadeIn(t, tx.at, 0.7) * 0.92}
              style={{ paintOrder: "stroke" }}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={5 * u}
            >
              {tx.text}
            </text>
          );
        })}

        {(scene.routes ?? []).map((r, i) => {
          const d = r.points
            .map(([lon, lat], j) => {
              const [x, y] = proj(lon, lat);
              return `${j === 0 ? "M" : "L"}${x} ${y}`;
            })
            .join("");
          const p = interpolate(t, [r.from, r.to], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.quad),
          });
          if (p <= 0) return null;
          return (
            <g key={`r${i}`}>
              <path
                d={d}
                fill="none"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={9}
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                strokeDasharray={`${p} 1`}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={d}
                fill="none"
                stroke={r.color ?? palette.gold}
                strokeWidth={5}
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                strokeDasharray={`${p} 1`}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {(scene.markers ?? []).map((m, i) => {
          const a = fadeIn(t, m.at, 0.4);
          if (a <= 0) return null;
          const [x, y] = proj(m.lon, m.lat);
          const pop = interpolate(t, [m.at, m.at + 0.35], [1.8, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const r = (m.style === "battle" ? 13 : 10) * u * pop;
          const side = m.labelSide ?? "right";
          const off = 22 * u;
          const lx = side === "left" ? x - off : side === "right" ? x + off : x;
          const ly = side === "above" ? y - off : side === "below" ? y + off + 26 * u : y + 11 * u;
          const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
          const pulse = m.style === "battle" ? 1 + 0.5 * ((t * 1.2) % 1) : 0;
          return (
            <g key={`m${i}`} opacity={a}>
              {m.style === "battle" ? (
                <circle
                  cx={x}
                  cy={y}
                  r={r * (1 + pulse * 1.6)}
                  fill="none"
                  stroke={palette.rome}
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  opacity={1 - ((t * 1.2) % 1)}
                />
              ) : null}
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={markerColor(m)}
                stroke={palette.ink}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                fontFamily={sans}
                fontWeight={700}
                fontSize={32 * u}
                fill={palette.parchment}
                stroke="rgba(0,0,0,0.75)"
                strokeWidth={6 * u}
                style={{ paintOrder: "stroke" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {(scene.routes ?? [])
          .filter((r) => r.label)
          .map((r, i) => {
            const mid = r.points[Math.floor(r.points.length / 2)];
            const [x, y] = proj(mid[0], mid[1]);
            return (
              <text
                key={`rl${i}`}
                x={x}
                y={y - 26 * u}
                textAnchor="middle"
                fontFamily={sans}
                fontWeight={500}
                fontSize={24 * u}
                fill={r.color ?? palette.gold}
                stroke="rgba(0,0,0,0.75)"
                strokeWidth={5 * u}
                style={{ paintOrder: "stroke" }}
                opacity={fadeIn(t, r.to - 0.4, 0.5)}
              >
                {r.label}
              </text>
            );
          })}
      </svg>

      {scene.note ? (
        <div
          style={{
            position: "absolute",
            top: 150,
            left: 56,
            right: 150,
            fontFamily: sans,
            fontWeight: 500,
            fontSize: 22,
            letterSpacing: 1,
            color: palette.parchment,
            opacity: 0.8 * fadeIn(t, scene.start + 0.3, 0.5),
            textShadow: "0 2px 8px rgba(0,0,0,0.9)",
          }}
        >
          {scene.note}
        </div>
      ) : null}
      {scene.title ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "center",
            paddingTop: 300,
            opacity: Math.min(
              fadeIn(t, scene.title.at, 0.8),
              scene.title.until
                ? interpolate(t, [scene.title.until - 0.6, scene.title.until], [1, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 1,
            ),
          }}
        >
          <div
            style={{
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 92,
              letterSpacing: 6,
              color: palette.parchment,
              textShadow: "0 4px 24px rgba(0,0,0,0.9)",
              textAlign: "center",
              lineHeight: 1.05,
            }}
          >
            {scene.title.text}
          </div>
          {scene.title.sub ? (
            <div
              style={{
                marginTop: 18,
                fontFamily: sans,
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: 10,
                color: palette.gold,
                textShadow: "0 2px 12px rgba(0,0,0,0.9)",
              }}
            >
              {scene.title.sub}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
