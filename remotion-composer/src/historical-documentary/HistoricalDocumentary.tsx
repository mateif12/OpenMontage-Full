import React from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { resolveAsset } from "../lib/resolveAsset";
import { ImageSceneView } from "../historical-short/ImageSceneView";
import { palette, sans, serif } from "../historical-short/theme";
import { DocMapView } from "./DocMapView";
import { TeutoburgBattleView } from "./TeutoburgBattleView";
import { LegionsView, ProfilesView } from "./CardScenes";
import { DocScene, EndCardScene, HistoricalDocumentaryProps, SourceLabel, SubtitleCue, TitleOverlay } from "./types";

// Landscape (1920x1080) narrated historical documentary. The narration master
// is the clock: every scene, label, subtitle and animation phase is keyed to
// absolute seconds in that file.

export const W = 1920;
export const H = 1080;
const FPS = 30;
const XFADE = 0.45;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ---------------------------------------------------------------- label card
const LabelCard: React.FC<{ label: SourceLabel; from: number; until: number; t: number }> = ({
  label,
  from,
  until,
  t,
}) => {
  const opacity = Math.min(interpolate(t, [from, from + 0.4], [0, 1], clamp), interpolate(t, [until - 0.35, until], [1, 0], clamp));
  const x = interpolate(t, [from, from + 0.5], [-16, 0], clamp);
  if (opacity <= 0) return null;
  return (
    <div style={{ position: "absolute", top: 56, left: 64, maxWidth: 880, opacity, transform: `translateX(${x}px)` }}>
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
        {label.tag}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: serif,
          fontWeight: 700,
          fontSize: 38,
          lineHeight: 1.12,
          color: palette.parchment,
          textShadow: "0 2px 14px rgba(0,0,0,0.9)",
        }}
      >
        {label.title}
      </div>
      {label.detail ? (
        <div
          style={{
            marginTop: 8,
            fontFamily: sans,
            fontWeight: 500,
            fontSize: 22,
            lineHeight: 1.32,
            color: palette.parchment,
            opacity: 0.94,
            textShadow: "0 2px 10px rgba(0,0,0,0.95)",
          }}
        >
          {label.detail}
        </div>
      ) : null}
      {label.credit ? (
        <div
          style={{
            marginTop: 8,
            fontFamily: sans,
            fontSize: 16,
            lineHeight: 1.3,
            color: palette.parchment,
            opacity: 0.75,
            textShadow: "0 2px 8px rgba(0,0,0,0.95)",
          }}
        >
          {label.credit}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------- title
const Title: React.FC<{ title: TitleOverlay; t: number }> = ({ title, t }) => {
  const o = Math.min(
    interpolate(t, [title.at, title.at + 0.9], [0, 1], clamp),
    title.until ? interpolate(t, [title.until - 0.7, title.until], [1, 0], clamp) : 1,
  );
  if (o <= 0) return null;
  const spread = interpolate(t, [title.at, title.at + 4], [14, 8], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div
        style={{
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: spread,
          color: palette.gold,
          textShadow: "0 2px 14px rgba(0,0,0,0.9)",
          marginBottom: 18,
        }}
      >
        {title.sub}
      </div>
      <div
        style={{
          fontFamily: serif,
          fontWeight: 700,
          fontSize: 96,
          lineHeight: 1.04,
          textAlign: "center",
          color: palette.parchment,
          textShadow: "0 6px 30px rgba(0,0,0,0.85)",
          maxWidth: 1500,
        }}
      >
        {title.text}
      </div>
      <div style={{ width: interpolate(t, [title.at + 0.3, title.at + 1.6], [0, 420], clamp), height: 2, background: palette.gold, marginTop: 26, opacity: 0.85 }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- end card
const EndCard: React.FC<{ scene: EndCardScene; t: number; durationInFrames: number }> = ({ scene, t, durationInFrames }) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, durationInFrames], [1.05, 1.12], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      {scene.background ? (
        <Img
          src={resolveAsset(scene.background)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${z})`,
            filter: "brightness(0.32) saturate(0.6) blur(2px)",
          }}
        />
      ) : null}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 22, letterSpacing: 8, color: palette.gold, opacity: interpolate(t, [scene.start + 0.2, scene.start + 0.9], [0, 1], clamp) }}>
          {scene.sub}
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: serif,
            fontWeight: 700,
            fontSize: 68,
            color: palette.parchment,
            textAlign: "center",
            opacity: interpolate(t, [scene.start + 0.3, scene.start + 1.1], [0, 1], clamp),
          }}
        >
          {scene.heading}
        </div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {scene.lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: sans,
                fontSize: 21,
                color: palette.parchment,
                opacity: 0.82 * interpolate(t, [scene.start + 0.5 + i * 0.15, scene.start + 1.0 + i * 0.15], [0, 1], clamp),
                textAlign: "center",
                maxWidth: 1400,
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- scenes
const gradeFilter = (g?: string) =>
  g === "none" ? undefined : g === "cool" ? "saturate(0.82) contrast(1.06) hue-rotate(-6deg)" : "saturate(0.86) contrast(1.06) sepia(0.12)";

const SceneBody: React.FC<{ scene: DocScene; durationInFrames: number; t: number }> = ({ scene, durationInFrames, t }) => {
  switch (scene.kind) {
    case "image":
      return (
        <AbsoluteFill style={{ filter: gradeFilter(scene.grade) }}>
          <ImageSceneView scene={scene} durationInFrames={durationInFrames} />
        </AbsoluteFill>
      );
    case "map":
      return <DocMapView scene={scene} />;
    case "battle":
      return <TeutoburgBattleView scene={scene} />;
    case "endcard":
      return <EndCard scene={scene} t={t} durationInFrames={durationInFrames} />;
    case "profiles":
      return <ProfilesView scene={scene} />;
    case "legions":
      return <LegionsView scene={scene} />;
    default:
      return null;
  }
};

const SceneShell: React.FC<{ scene: DocScene; durationInFrames: number; isFirst: boolean; isLast: boolean }> = ({
  scene,
  durationInFrames,
  isFirst,
  isLast,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const fadeIn = Math.round((scene.fadeIn ?? (isFirst ? 1.0 : XFADE)) * fps);
  const fadeOut = Math.round((scene.fadeOut ?? (isLast ? 1.4 : 0)) * fps);
  const opacity = Math.min(
    fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], clamp) : 1,
    fadeOut > 0 ? interpolate(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0], clamp) : 1,
  );
  const isImage = scene.kind === "image";
  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneBody scene={scene} durationInFrames={durationInFrames} t={t} />
      {isImage ? (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.6) 100%)",
          }}
        />
      ) : null}
      {scene.label ? <LabelCard label={scene.label} from={scene.labelAt ?? scene.start + 0.25} until={scene.end} t={t} /> : null}
      {scene.title ? <Title title={scene.title} t={t} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- subtitles
const Subtitles: React.FC<{ cues: SubtitleCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  const o = Math.min(interpolate(t, [cue.start, cue.start + 0.12], [0, 1], clamp), interpolate(t, [cue.end - 0.1, cue.end], [1, 0], clamp));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 58, display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          background: "rgba(8, 8, 6, 0.66)",
          borderRadius: 6,
          padding: "10px 26px 12px",
          maxWidth: 1500,
          textAlign: "center",
        }}
      >
        {cue.lines.map((l, i) => (
          <div
            key={i}
            style={{ fontFamily: sans, fontWeight: 500, fontSize: 40, lineHeight: 1.28, color: "#f6f0e2", letterSpacing: 0.2 }}
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  );
};

export const HistoricalDocumentary: React.FC<HistoricalDocumentaryProps> = ({
  narrationSrc,
  ambienceSrc,
  ambienceVolume = 0.05,
  scenes,
  subtitleCues = [],
  durationSeconds,
}) => {
  const { fps } = useVideoConfig();
  const total = Math.ceil(durationSeconds * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      {scenes.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const isLast = i === scenes.length - 1;
        const endSec = isLast ? durationSeconds : scene.end + XFADE;
        const dur = Math.max(1, Math.min(total - from, Math.round(endSec * fps) - from));
        return (
          <Sequence key={scene.id} from={from} durationInFrames={dur} name={scene.id}>
            <SceneShell scene={scene} durationInFrames={dur} isFirst={i === 0} isLast={isLast} />
          </Sequence>
        );
      })}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 48%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.5) 100%)" }} />
      <Subtitles cues={subtitleCues} />
      <Audio src={resolveAsset(narrationSrc)} />
      {ambienceSrc ? <Audio src={resolveAsset(ambienceSrc)} volume={ambienceVolume} /> : null}
    </AbsoluteFill>
  );
};

export const calculateHistoricalDocumentaryMetadata: CalculateMetadataFunction<HistoricalDocumentaryProps> = async ({
  props,
}) => ({
  durationInFrames: Math.max(1, Math.ceil(props.durationSeconds * FPS)),
  fps: FPS,
  width: W,
  height: H,
});
