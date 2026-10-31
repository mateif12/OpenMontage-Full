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
import { palette, sans, serif } from "../historical-short/theme";
import { DocMapMarker, DocMapScene, MapCameraKey } from "./types";

// Original animated map (landscape). Basemap = Natural Earth land, lakes and
// river centrelines (public domain, modern geography) in the equirectangular
// projection written by build_basemap.py: x = lon * kx, y = -lat.

const W = 1920;
const H = 1080;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

interface Basemap {
  kx: number;
  land: string[];
  lakes: string[];
  rivers?: { name: string; d: string }[];
}

const cache: Record<string, Basemap> = {};

const useBasemap = (src: string): Basemap | null => {
  const [data, setData] = useState<Basemap | null>(cache[src] ?? null);
  const [handle] = useState(() => (cache[src] ? null : delayRender(`basemap ${src}`)));
  useEffect(() => {
    if (cache[src]) return;
    fetch(resolveAsset(src))
      .then((r) => r.json())
      .then((json) => {
        cache[src] = json;
        setData(json);
        if (handle !== null) continueRender(handle);
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
      const span = Math.exp(Math.log(a.span) + (Math.log(b.span) - Math.log(a.span)) * p);
      return { t, lon: a.lon + (b.lon - a.lon) * p, lat: a.lat + (b.lat - a.lat) * p, span };
    }
  }
  return keys[keys.length - 1];
};

const fade = (t: number, at: number, until?: number, dur = 0.5) =>
  Math.min(
    interpolate(t, [at, at + dur], [0, 1], clamp),
    until !== undefined ? interpolate(t, [until - dur, until], [1, 0], clamp) : 1,
  );

const markerFill = (m: DocMapMarker) =>
  m.style === "battle" ? palette.rome : m.style === "base" ? "#e05a4e" : m.style === "camp" ? "#e8a07a" : palette.parchment;

export const DocMapView: React.FC<{ scene: DocMapScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const base = useBasemap(scene.basemap);
  if (!base) return <AbsoluteFill style={{ backgroundColor: palette.sea }} />;

  const kx = base.kx;
  const cam = cameraAt(scene.camera, t);
  const vbW = cam.span * kx;
  const vbH = (vbW * H) / W;
  const cx = cam.lon * kx;
  const cy = -cam.lat;
  const u = vbW / W; // map units per screen px
  const P = (lon: number, lat: number): [number, number] => [lon * kx, -lat];
  const highlighted = new Map<string, { at: number; color: string; width: number }>();
  for (const h of scene.riverHighlights ?? []) {
    for (const n of h.names) highlighted.set(n, { at: h.at, color: h.color ?? palette.gold, width: h.width ?? 5 });
  }

  const textEl = (
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    opts: { anchor?: "start" | "middle" | "end"; weight?: number; italic?: boolean; spacing?: number; opacity?: number; family?: string } = {},
  ) => (
    <text
      x={x}
      y={y}
      textAnchor={opts.anchor ?? "middle"}
      fontFamily={opts.family ?? sans}
      fontWeight={opts.weight ?? 700}
      fontStyle={opts.italic ? "italic" : "normal"}
      fontSize={size * u}
      letterSpacing={(opts.spacing ?? 0) * u}
      fill={color}
      opacity={opts.opacity ?? 1}
      stroke="rgba(0,0,0,0.78)"
      strokeWidth={5 * u}
      style={{ paintOrder: "stroke" }}
    >
      {text}
    </text>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.seaDeep }}>
      <svg width={W} height={H} viewBox={`${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`}>
        <defs>
          <pattern id="mapgrid" width={1 * kx} height={1} patternUnits="userSpaceOnUse">
            <path d={`M${kx} 0H0V1`} fill="none" stroke="rgba(241,230,204,0.06)" strokeWidth={1.2 * u} />
          </pattern>
          <pattern id="hatch" width={14 * u} height={14 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1={0} y1={0} x2={0} y2={14 * u} stroke="rgba(217,178,95,0.55)" strokeWidth={3 * u} />
          </pattern>
          <radialGradient id="landshade" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#4a4030" />
            <stop offset="100%" stopColor="#2c261c" />
          </radialGradient>
        </defs>
        <rect x={cx - vbW} y={cy - vbH} width={vbW * 2} height={vbH * 2} fill={palette.sea} />
        <rect x={cx - vbW} y={cy - vbH} width={vbW * 2} height={vbH * 2} fill="url(#mapgrid)" />
        {base.land.map((d, i) => (
          <path key={`l${i}`} d={d} fill="url(#landshade)" stroke={palette.landEdge} strokeWidth={1.6 * u} strokeOpacity={0.7} />
        ))}
        {base.lakes.map((d, i) => (
          <path key={`k${i}`} d={d} fill={palette.sea} stroke={palette.landEdge} strokeWidth={1 * u} strokeOpacity={0.5} />
        ))}
        {(base.rivers ?? []).map((r, i) => {
          const h = highlighted.get(r.name);
          const hp = h ? interpolate(t, [h.at, h.at + 0.8], [0, 1], clamp) : 0;
          return (
            <g key={`r${i}`}>
              <path d={r.d} fill="none" stroke="#5f8aa0" strokeWidth={2.2 * u} strokeOpacity={0.85} strokeLinejoin="round" />
              {h && hp > 0 ? (
                <path d={r.d} fill="none" stroke={h.color} strokeWidth={h.width * u} strokeOpacity={0.9 * hp} strokeLinejoin="round" strokeLinecap="round" />
              ) : null}
            </g>
          );
        })}

        {(scene.areas ?? []).map((a, i) => {
          const o = fade(t, a.at, a.until, 0.7);
          if (o <= 0) return null;
          const d = "M" + a.points.map(([lo, la]) => P(lo, la).join(" ")).join("L") + "Z";
          return (
            <g key={`a${i}`} opacity={o}>
              <path d={d} fill={a.hatch ? "url(#hatch)" : (a.color ?? "rgba(217,178,95,0.18)")} stroke={a.color ?? palette.gold} strokeWidth={2 * u} strokeDasharray={`${10 * u} ${8 * u}`} />
            </g>
          );
        })}

        {(scene.texts ?? []).map((tx, i) => {
          const o = fade(t, tx.at, tx.until, 0.6);
          if (o <= 0) return null;
          const [x, y] = P(tx.lon, tx.lat);
          return (
            <g key={`t${i}`} opacity={o}>
              {textEl(x, y, tx.text, tx.size ?? 30, tx.color ?? palette.parchment, {
                italic: tx.italic,
                spacing: tx.spacing ?? 6,
                weight: tx.italic ? 500 : 700,
                family: tx.italic ? serif : sans,
              })}
            </g>
          );
        })}

        {(scene.routes ?? []).map((r, i) => {
          const p = interpolate(t, [r.from, r.to], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
          const o = r.until !== undefined ? interpolate(t, [r.until - 0.5, r.until], [1, 0], clamp) : 1;
          if (p <= 0 || o <= 0) return null;
          const pts = r.points.map(([lo, la]) => P(lo, la));
          // polyline length + partial draw
          const seg: number[] = [];
          let L = 0;
          for (let k = 1; k < pts.length; k++) {
            const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
            seg.push(d);
            L += d;
          }
          let remain = L * p;
          const drawn: [number, number][] = [pts[0]];
          let ang = 0;
          for (let k = 1; k < pts.length && remain > 0; k++) {
            const d = seg[k - 1];
            const f = Math.min(1, remain / d);
            const x = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f;
            const y = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f;
            ang = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
            drawn.push([x, y]);
            remain -= d;
          }
          const tip = drawn[drawn.length - 1];
          const color = r.color ?? palette.rome;
          const w = (r.width ?? 6) * u;
          const hl = w * 3.2;
          return (
            <g key={`ro${i}`} opacity={o}>
              <polyline
                points={drawn.map((q) => q.join(",")).join(" ")}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={w + 4 * u}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={r.dashed ? `${w * 2.4} ${w * 1.8}` : undefined}
              />
              <polyline
                points={drawn.map((q) => q.join(",")).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={w}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={r.dashed ? `${w * 2.4} ${w * 1.8}` : undefined}
              />
              {r.arrow !== false ? (
                <polygon
                  points={`${tip[0] + Math.cos(ang) * hl},${tip[1] + Math.sin(ang) * hl} ${tip[0] + Math.cos(ang + 2.4) * hl},${tip[1] + Math.sin(ang + 2.4) * hl} ${tip[0] + Math.cos(ang - 2.4) * hl},${tip[1] + Math.sin(ang - 2.4) * hl}`}
                  fill={color}
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth={1.5 * u}
                />
              ) : null}
              {r.label
                ? (() => {
                    const mid = pts[Math.floor(pts.length / 2)];
                    return (
                      <g opacity={interpolate(t, [r.to - 0.4, r.to + 0.2], [0, 1], clamp)}>
                        {textEl(mid[0], mid[1] - 22 * u, r.label, 24, color, { weight: 700, spacing: 2 })}
                      </g>
                    );
                  })()
                : null}
            </g>
          );
        })}

        {(scene.markers ?? []).map((m, i) => {
          const o = fade(t, m.at, m.until, 0.4);
          if (o <= 0) return null;
          const [x, y] = P(m.lon, m.lat);
          const pop = interpolate(t, [m.at, m.at + 0.35], [1.8, 1], clamp);
          const r = (m.style === "battle" ? 12 : m.style === "base" ? 10 : 9) * u * pop;
          const side = m.labelSide ?? "right";
          const off = 20 * u;
          const lx = side === "left" ? x - off : side === "right" ? x + off : x;
          const ly = side === "above" ? y - off - 4 * u : side === "below" ? y + off + 22 * u : y + 9 * u;
          const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
          const ab = m.abandonedAt !== undefined ? interpolate(t, [m.abandonedAt, m.abandonedAt + 0.6], [0, 1], clamp) : 0;
          const ring = (t * 1.1) % 1;
          return (
            <g key={`m${i}`} opacity={o}>
              {m.style === "battle" ? (
                <circle cx={x} cy={y} r={r * (1 + ring * 2.2)} fill="none" stroke={palette.rome} strokeWidth={3 * u} opacity={1 - ring} />
              ) : null}
              {m.style === "base" ? (
                <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={ab > 0.5 ? "#6b5d4a" : markerFill(m)} stroke={palette.ink} strokeWidth={3 * u} />
              ) : m.style === "uncertain" || m.style === "camp" ? (
                <circle cx={x} cy={y} r={r} fill="none" stroke={markerFill(m)} strokeWidth={4 * u} strokeDasharray={`${5 * u} ${4 * u}`} />
              ) : (
                <circle cx={x} cy={y} r={r} fill={markerFill(m)} stroke={palette.ink} strokeWidth={3 * u} />
              )}
              {ab > 0 ? (
                <g opacity={ab} stroke={palette.parchment} strokeWidth={3.5 * u} strokeLinecap="round">
                  <line x1={x - r * 1.5} y1={y - r * 1.5} x2={x + r * 1.5} y2={y + r * 1.5} />
                  <line x1={x - r * 1.5} y1={y + r * 1.5} x2={x + r * 1.5} y2={y - r * 1.5} />
                </g>
              ) : null}
              {textEl(lx, ly, m.label, 26, palette.parchment, { anchor })}
              {m.sub ? textEl(lx, ly + 26 * u, m.sub, 18, palette.gold, { anchor, weight: 500 }) : null}
            </g>
          );
        })}
      </svg>

      {scene.heading ? (
        <div style={{ position: "absolute", top: 56, left: 64, opacity: fade(t, scene.heading.at ?? scene.start + 0.2) }}>
          <div
            style={{
              display: "inline-block",
              fontFamily: sans,
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: 3,
              color: palette.ink,
              background: palette.gold,
              padding: "5px 12px",
              borderRadius: 3,
            }}
          >
            {scene.heading.tag}
          </div>
          <div style={{ marginTop: 12, fontFamily: serif, fontWeight: 700, fontSize: 40, color: palette.parchment, textShadow: "0 2px 14px rgba(0,0,0,0.9)" }}>
            {scene.heading.text}
          </div>
        </div>
      ) : null}
      {(scene.notes ?? []).map((n, i) => {
        const o = fade(t, n.at, n.until, 0.5);
        if (o <= 0) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              right: 64,
              top: 60 + i * 0,
              maxWidth: 560,
              padding: "14px 18px",
              background: "rgba(10,9,7,0.72)",
              borderLeft: `4px solid ${palette.gold}`,
              fontFamily: sans,
              fontSize: 22,
              lineHeight: 1.35,
              color: palette.parchment,
              opacity: o,
            }}
          >
            {n.text}
          </div>
        );
      })}
      {scene.footnote ? (
        <div
          style={{
            position: "absolute",
            right: 40,
            bottom: 18,
            fontFamily: sans,
            fontSize: 15,
            letterSpacing: 1,
            color: palette.parchment,
            opacity: 0.6,
          }}
        >
          {scene.footnote}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
