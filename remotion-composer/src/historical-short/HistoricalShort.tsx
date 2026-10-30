import React from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { BattleSceneView } from "./BattleSceneView";
import { FxLayer, GrainLayer } from "./FxLayer";
import { resolveAsset } from "../lib/resolveAsset";
import { IllustrationSceneView } from "./IllustrationSceneView";
import { ImageSceneView } from "./ImageSceneView";
import { MapSceneView } from "./MapSceneView";
import { SourceLabelCard } from "./SourceLabelCard";
import { TacticsSceneView } from "./TacticsSceneView";
import { HistoricalScene, HistoricalShortProps } from "./types";
import { palette, sans } from "./theme";

// Vertical (1080x1920) narrated historical Short for the documentary-montage
// historical-short profile. The narration MP3 is the master clock: every
// scene, caption and phase time is an absolute second in that file.

const FPS = 30;
const W_FRAME = 1080;
const XFADE = 0.35; // seconds a scene overlaps the next one for a dissolve

const SceneBody: React.FC<{ scene: HistoricalScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  switch (scene.kind) {
    case "image":
      return <ImageSceneView scene={scene} durationInFrames={durationInFrames} />;
    case "map":
      return <MapSceneView scene={scene} />;
    case "tactics":
      return <TacticsSceneView scene={scene} />;
    case "illustration":
      return <IllustrationSceneView scene={scene} durationInFrames={durationInFrames} />;
    case "battle":
      return <BattleSceneView scene={scene} />;
    default:
      return null;
  }
};

const SceneShell: React.FC<{
  scene: HistoricalScene;
  durationInFrames: number;
  isFirst: boolean;
  isLast: boolean;
  plate?: boolean;
}> = ({ scene, durationInFrames, isFirst, isLast, plate }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tr = isFirst ? "crossfade" : scene.transition ?? "crossfade";
  const defaultIn = isFirst ? 0.6 : tr === "cut" || tr === "dip" || tr === "whip" ? 0 : tr === "flash" ? 0.1 : XFADE;
  const fadeIn = Math.round((scene.fadeIn ?? defaultIn) * fps);
  const fadeOut = Math.round((scene.fadeOut ?? (isLast ? 1.0 : 0)) * fps);
  const sec = frame / fps;
  const opacity = Math.min(
    fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: "clamp" }) : 1,
    fadeOut > 0
      ? interpolate(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1,
  );
  const labelFrames = Math.round((scene.end - scene.start) * fps);
  if (plate) {
    return (
      <AbsoluteFill>
        <SceneBody scene={scene} durationInFrames={durationInFrames} />
      </AbsoluteFill>
    );
  }
  // whip pan: the new scene slides in fast from the right
  const whipX =
    tr === "whip" ? interpolate(sec, [0, 0.32], [W_FRAME * 0.85, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 0;
  const dipA = tr === "dip" ? interpolate(sec, [0, 0.5], [1, 0], { extrapolateRight: "clamp" }) : 0;
  const flashA = tr === "flash" ? interpolate(sec, [0, 0.05, 0.4], [0.2, 0.9, 0], { extrapolateRight: "clamp" }) : 0;
  const smokeA = tr === "smoke" ? interpolate(sec, [0, 0.25, 1.1], [0.4, 0.92, 0], { extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={{ opacity, transform: whipX ? `translateX(${whipX}px)` : undefined }}>
      <SceneBody scene={scene} durationInFrames={durationInFrames} />
      {scene.fx ? <FxLayer fx={scene.fx} sceneId={scene.id} sceneStart={scene.start} /> : null}
      {/* legibility gradients for label (top) and captions (lower third) */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.0) 26%, rgba(0,0,0,0.0) 55%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.7) 100%)",
        }}
      />
      {scene.label ? <SourceLabelCard label={scene.label} durationInFrames={labelFrames} /> : null}
      {dipA > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dipA})` }} /> : null}
      {flashA > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(255,244,222,${flashA})` }} /> : null}
      {smokeA > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 45% 55%, rgba(206,200,186,${smokeA}) 0%, rgba(160,154,140,${
              smokeA * 0.9
            }) 45%, rgba(60,56,50,${smokeA * 0.7}) 100%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const HistoricalShort: React.FC<HistoricalShortProps> = ({
  narrationSrc,
  ambienceSrc,
  ambienceVolume = 0.06,
  scenes,
  captions,
  captionStyle,
  durationSeconds,
  globalFx,
  plate,
}) => {
  const { fps } = useVideoConfig();
  const total = Math.ceil(durationSeconds * fps);
  const bottomOffset = captionStyle?.bottomOffset ?? 470;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      {scenes.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const isLast = i === scenes.length - 1;
        const endSec = isLast ? durationSeconds : scene.end + XFADE;
        const dur = Math.max(1, Math.min(total - from, Math.round(endSec * fps) - from));
        return (
          <Sequence key={scene.id} from={from} durationInFrames={dur} name={scene.id}>
            <SceneShell scene={scene} durationInFrames={dur} isFirst={i === 0} isLast={isLast} plate={plate} />
          </Sequence>
        );
      })}

      {plate ? null : (
        <>
      {/* vignette */}
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)" }}
      />

      {globalFx ? <GrainLayer fx={globalFx} /> : null}

      {/* captions sit above the Shorts bottom UI (title / channel row) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920 - bottomOffset }}>
        <CaptionOverlay
          words={captions}
          wordsPerPage={captionStyle?.wordsPerPage ?? 5}
          fontSize={captionStyle?.fontSize ?? 60}
          color={palette.parchment}
          highlightColor={captionStyle?.highlightColor ?? "#f0c75e"}
          backgroundColor="rgba(10, 9, 7, 0.62)"
          fontFamily={sans}
        />
      </div>

      <Audio src={resolveAsset(narrationSrc)} />
      {ambienceSrc ? <Audio src={resolveAsset(ambienceSrc)} volume={ambienceVolume} /> : null}
        </>
      )}
    </AbsoluteFill>
  );
};

export const calculateHistoricalShortMetadata: CalculateMetadataFunction<HistoricalShortProps> = async ({
  props,
}) => ({
  durationInFrames: Math.max(1, Math.ceil(props.durationSeconds * FPS)),
  fps: FPS,
  width: 1080,
  height: 1920,
});
