import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { resolveAsset } from "../lib/resolveAsset";
import { ImageScene } from "./types";

// Slow push-in / pan on an authentic still. Motion is camera-only: the image
// itself is never altered or animated, so it reads as a photograph, not footage.
export const ImageSceneView: React.FC<{ scene: ImageScene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(t, [0, 1], [scene.zoomFrom ?? 1.04, scene.zoomTo ?? 1.12]);
  const px = scene.panX ? interpolate(t, [0, 1], scene.panX) : 0;
  const py = scene.panY ? interpolate(t, [0, 1], scene.panY) : 0;
  const src = resolveAsset(scene.src);
  const focus = `${(scene.focusX ?? 0.5) * 100}% ${(scene.focusY ?? 0.5) * 100}%`;

  if (scene.fit === "contain-blur") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: -80,
            width: "calc(100% + 160px)",
            height: "calc(100% + 160px)",
            objectFit: "cover",
            filter: "blur(38px) brightness(0.42) saturate(0.8)",
          }}
        />
        <AbsoluteFill
          style={{
            transform: `translate(${px}px, ${py}px) scale(${zoom})`,
            transformOrigin: focus,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: focus,
          transform: `translate(${px}px, ${py}px) scale(${zoom})`,
          transformOrigin: focus,
        }}
      />
    </AbsoluteFill>
  );
};
