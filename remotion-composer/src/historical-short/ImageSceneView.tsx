import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset } from "../lib/resolveAsset";
import { ImageCameraKey, ImageScene } from "./types";

const W = 1080;
const H = 1920;
// A whole painting rests with its focus at 40% of the frame height, keeping it
// clear of the caption block (≈1170-1365 px).
const ANCHOR_Y = 0.4 * H;
// Top of the caption block with the default caption style (measured ≈1170 px).
// An image that does not fill the frame is kept above it.
const CAPTION_TOP = 1150;
const ease = Easing.inOut(Easing.cubic);

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));

const cameraAt = (keys: ImageCameraKey[], t: number): ImageCameraKey => {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const p = ease((t - a.t) / Math.max(0.001, b.t - a.t));
      return {
        t,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        // geometric zoom interpolation feels uniform
        zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * p),
      };
    }
  }
  return keys[keys.length - 1];
};

// Cinematic camera over a painting/photo: detail shots, pans along the
// canvas, reveals of the whole work, optional depth-layer parallax. The image
// is only ever scaled uniformly and moved — never stretched or altered.
const CameraImage: React.FC<{ scene: ImageScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scene.start + frame / fps;
  const [iw, ih] = scene.imageSize as [number, number];
  const cam = cameraAt(scene.camera as ImageCameraKey[], t);
  const s = Math.min(W / iw, H / ih) * cam.zoom;
  const dw = iw * s;
  const dh = ih * s;
  const left = clamp(W / 2 - cam.x * dw, 0, W - dw);
  let top = clamp((dh < H ? ANCHOR_Y : H / 2) - cam.y * dh, 0, H - dh);
  if (dh < H) top = Math.min(top, Math.max(0, CAPTION_TOP - dh)); // continuous at dh = CAPTION_TOP and dh = H

  const prog = ease(Math.min(1, Math.max(0, (t - scene.start) / Math.max(0.001, scene.end - scene.start))));
  const amp = scene.parallax ?? 36;
  const [dx, dy] = scene.parallaxDir ?? [1, 0.15];
  const layers = scene.layers && scene.layers.length ? scene.layers : [{ src: scene.src, depth: 0 }];

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {scene.blurSrc && (dw < W || dh < H) ? (
        <Img
          src={resolveAsset(scene.blurSrc)}
          style={{ position: "absolute", inset: -80, width: "calc(100% + 160px)", height: "calc(100% + 160px)" }}
        />
      ) : null}
      {layers.map((layer, i) => {
        const drift = (prog - 0.5) * 2 * amp * layer.depth;
        const grow = 1 + layer.depth * 0.035 * prog;
        return (
          <Img
            key={i}
            src={resolveAsset(layer.src)}
            style={{
              position: "absolute",
              left,
              top,
              width: dw,
              height: dh,
              transform: `translate(${drift * dx}px, ${drift * dy}px) scale(${grow})`,
              transformOrigin: `${(W / 2 - left) / dw * 100}% ${(H / 2 - top) / dh * 100}%`,
              boxShadow: i === 0 && (dw < W || dh < H) ? "0 30px 80px rgba(0,0,0,0.6)" : undefined,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Slow push-in / pan on an authentic still. Motion is camera-only: the image
// itself is never altered or animated, so it reads as a photograph, not footage.
export const ImageSceneView: React.FC<{ scene: ImageScene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  if (scene.camera && scene.camera.length && scene.imageSize) {
    return <CameraImage scene={scene} />;
  }
  return <LegacyImage scene={scene} durationInFrames={durationInFrames} />;
};

// Original behaviour (fit/zoomFrom/zoomTo/panX/panY) — kept for older episodes.
const LegacyImage: React.FC<{ scene: ImageScene; durationInFrames: number }> = ({
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
        {scene.blurSrc ? (
          // pre-rendered by build_props.py (much cheaper than a per-frame CSS blur)
          <Img
            src={resolveAsset(scene.blurSrc)}
            style={{ position: "absolute", inset: -80, width: "calc(100% + 160px)", height: "calc(100% + 160px)" }}
          />
        ) : (
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
        )}
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
