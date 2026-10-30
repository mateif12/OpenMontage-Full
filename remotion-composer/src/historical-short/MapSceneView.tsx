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
import { MapCameraKey, MapMarker, MapRoute, MapScene, MapUnit } from "./types";
import { palette, sans, serif } from "./theme";

interface Basemap {
  kx: number;
  land: string[];
  lakes: string[];
}

const W = 1080;
const H = 1920;

// No basemap ("none" / omitted): plain land everywhere — right for battlefield-scale
// maps and tactical diagrams, and cheaper to render than coastline paths.
const useBasemap = (src: string | undefined, lat0: number): Basemap | null => {
  const none = !src || src === "none";
  const [data, setData] = useState<Basemap | null>(() =>
    none ? { kx: Math.cos((lat0 * Math.PI) / 180), land: [], lakes: [] } : null,
  );
  const [handle] = useState(() => (none ? null : delayRender(`Loading basemap ${src}`)));
  useEffect(() => {
    if (none || handle === null) return;
    fetch(resolveAsset(src as string))
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(new Error(`Basemap ${src} failed: ${err}`)));
  }, [src, handle, none]);
  return data;
};

interface Terrain {
  src: string;
  bbox: [number, number, number, number];
}

const useTerrain = (src: string | undefined): Terrain | null => {
  const [data, setData] = useState<Terrain | null>(null);
  const [handle] = useState(() => (src ? delayRender(`Loading terrain ${src}`) : null));
  useEffect(() => {
    if (!src || handle === null) return;
    fetch(resolveAsset(src))
      .then((r) => r.json())
      .then((json) => {
        const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/") + 1) : "";
        setData({ src: dir + json.src, bbox: json.bbox });
        continueRender(handle);
      })
      .catch((err) => cancelRender(new Error(`Terrain ${src} failed: ${err}`)));
  }, [src, handle]);
  return data;
};

const ease = Easing.inOut(Easing.cubic);

const unitAt = (u: MapUnit, t: number) => {
  const k = u.keys;
  if (t <= k[0].t) return { lon: k[0].lon, lat: k[0].lat, dir: k.length > 1 ? [k[1].lon - k[0].lon, k[1].lat - k[0].lat] : [1, 0] };
  for (let i = 0; i < k.length - 1; i++) {
    if (t <= k[i + 1].t) {
      const p = ease((t - k[i].t) / Math.max(0.001, k[i + 1].t - k[i].t));
      return {
        lon: k[i].lon + (k[i + 1].lon - k[i].lon) * p,
        lat: k[i].lat + (k[i + 1].lat - k[i].lat) * p,
        dir: [k[i + 1].lon - k[i].lon, k[i + 1].lat - k[i].lat],
      };
    }
  }
  const n = k.length;
  return { lon: k[n - 1].lon, lat: k[n - 1].lat, dir: n > 1 ? [k[n - 1].lon - k[n - 2].lon, k[n - 1].lat - k[n - 2].lat] : [1, 0] };
};

// Partial polyline up to fraction p of its length (+ tip direction) in map units.
const partialPath = (pts: [number, number][], p: number) => {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let left = total * p;
  const out: [number, number][] = [pts[0]];
  let dir: [number, number] = [1, 0];
  for (let i = 1; i < pts.length; i++) {
    const l = seg[i - 1];
    dir = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    if (left >= l) {
      out.push(pts[i]);
      left -= l;
    } else {
      const f = l > 0 ? left / l : 0;
      out.push([pts[i - 1][0] + dir[0] * f, pts[i - 1][1] + dir[1] * f]);
      break;
    }
  }
  return { pts: out, dir };
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

// Route with arrowhead / retreat dashes / custom width (drawn as a partial path).
const StyledRoute: React.FC<{ r: MapRoute; p: number; kx: number; u: number }> = ({ r, p, kx, u }) => {
  const pts = r.points.map(([lon, lat]) => [lon * kx, -lat] as [number, number]);
  const { pts: part, dir } = partialPath(pts, p);
  const d = part.map(([x, y], j) => `${j === 0 ? "M" : "L"}${x} ${y}`).join("");
  const width = r.width ?? 5;
  const color = r.color ?? palette.gold;
  const dash = r.style === "retreat" ? `${width * 2.4} ${width * 1.8}` : undefined;
  const [tx, ty] = part[part.length - 1];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  const ah = (width * 4.2 + 8) * u; // arrowhead length in map units
  const aw = (width * 2.6 + 6) * u;
  return (
    <g>
      <path d={d} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={width + 4} vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      <path d={d} fill="none" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      {r.arrow && p > 0.04 ? (
        <path
          d={`M${tx + ux * ah * 0.6},${ty + uy * ah * 0.6} L${tx - ux * ah * 0.4 - uy * aw},${ty - uy * ah * 0.4 + ux * aw} L${
            tx - ux * ah * 0.4 + uy * aw
          },${ty - uy * ah * 0.4 - ux * aw} Z`}
          fill={color}
          stroke="rgba(0,0,0,0.6)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
};

export const MapSceneView: React.FC<{ scene: MapScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps; // absolute narration time
  const base = useBasemap(scene.basemap, scene.camera[0].lat);
  const terrain = useTerrain(scene.terrain);
  if (!base) return <AbsoluteFill style={{ backgroundColor: palette.sea }} />;
  const plainLand = !scene.basemap || scene.basemap === "none";

  const kx = base.kx;
  const cam = cameraAt(scene.camera, t);
  const vbW = cam.span * kx;
  const vbH = (vbW * H) / W;
  const cx = cam.lon * kx;
  const cy = -cam.lat;
  const u = vbW / W; // map units per screen pixel
  const proj = (lon: number, lat: number): [number, number] => [lon * kx, -lat];

  const markerColor = (m: MapMarker) =>
    m.color ??
    (m.style === "capital-rome" || m.style === "battle" || m.style === "capital"
      ? palette.rome
      : m.style === "capital-carthage"
        ? palette.carthage
        : palette.parchment);
  const screenX = (x: number) => (x - (cx - vbW / 2)) / u;

  return (
    <AbsoluteFill style={{ backgroundColor: plainLand ? palette.land : palette.seaDeep, overflow: "hidden" }}>
      <svg
        width={W}
        height={H}
        viewBox={`${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`}
        style={
          scene.tilt
            ? { transform: `perspective(1700px) rotateX(${scene.tilt}deg) scale(${1 + scene.tilt / 55})`, transformOrigin: "50% 62%" }
            : undefined
        }
      >
        <defs>
          <radialGradient id="seaGlow" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor={palette.sea} />
            <stop offset="100%" stopColor={palette.seaDeep} />
          </radialGradient>
        </defs>
        <rect x={cx - vbW} y={cy - vbH} width={vbW * 2} height={vbH * 2} fill={plainLand ? palette.land : "url(#seaGlow)"} />
        {terrain ? (
          <image
            href={resolveAsset(terrain.src)}
            x={terrain.bbox[0] * kx}
            y={-terrain.bbox[3]}
            width={(terrain.bbox[2] - terrain.bbox[0]) * kx}
            height={terrain.bbox[3] - terrain.bbox[1]}
            preserveAspectRatio="none"
          />
        ) : null}
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
          if (r.arrow || r.style || r.width) return <StyledRoute key={`r${i}`} r={r} p={p} kx={kx} u={u} />;
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

        {(scene.units ?? []).map((un, i) => {
          const appear = un.at ?? un.keys[0].t;
          const a = Math.min(fadeIn(t, appear, 0.4), un.until ? interpolate(t, [un.until - 0.4, un.until], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1);
          if (a <= 0) return null;
          const pos = unitAt(un, t);
          const [x, y] = proj(pos.lon, pos.lat);
          // symbols stay upright (standard); a separate arrow on the block's edge shows direction
          const ang = Math.atan2(-pos.dir[1], pos.dir[0] * kx);
          const w = (un.w ?? 84) * u;
          const h = (un.h ?? 40) * u;
          const edge = Math.min(w / 2 / Math.max(0.01, Math.abs(Math.cos(ang))), h / 2 / Math.max(0.01, Math.abs(Math.sin(ang))));
          const moving = Math.hypot(pos.dir[0], pos.dir[1]) > 1e-6;
          return (
            <g key={`u${i}`} opacity={a}>
              <g transform={`translate(${x} ${y})`}>
                <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={un.color} stroke={palette.ink} strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke" opacity={0.92} />
                {un.kind === "cavalry" ? (
                  <line x1={-w / 2} y1={h / 2} x2={w / 2} y2={-h / 2} stroke={palette.ink} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                ) : un.kind === "artillery" ? (
                  <circle cx={0} cy={0} r={h * 0.22} fill={palette.ink} />
                ) : (
                  <g stroke={palette.ink} strokeWidth={2.5}>
                    <line x1={-w / 2} y1={-h / 2} x2={w / 2} y2={h / 2} vectorEffect="non-scaling-stroke" />
                    <line x1={-w / 2} y1={h / 2} x2={w / 2} y2={-h / 2} vectorEffect="non-scaling-stroke" />
                  </g>
                )}
                {moving ? (
                  <g transform={`rotate(${(ang * 180) / Math.PI})`}>
                    <path d={`M${edge + 5 * u},${-11 * u} L${edge + 24 * u},0 L${edge + 5 * u},${11 * u} Z`} fill={un.color}
                      stroke={palette.ink} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </g>
                ) : null}
              </g>
              {un.label ? (
                <text x={x} y={y + h / 2 + 36 * u} textAnchor="middle" fontFamily={sans} fontWeight={700} fontSize={30 * u}
                  fill={palette.parchment} stroke="rgba(0,0,0,0.75)" strokeWidth={5 * u} style={{ paintOrder: "stroke" }}>
                  {un.label}
                </text>
              ) : null}
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
          let side = m.labelSide ?? "right";
          {
            // keep labels inside the frame: flip left/right when they would be clipped
            const sx = screenX(x);
            const lw = m.label.length * 32 * 0.56 + 22;
            if (side === "right" && sx + lw > W - 12) side = "left";
            else if (side === "left" && sx - lw < 12) side = "right";
          }
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
              {m.style === "fort" ? (
                <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={markerColor(m)} stroke={palette.ink}
                  strokeWidth={3} vectorEffect="non-scaling-stroke" />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={markerColor(m)}
                  stroke={palette.ink}
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
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
