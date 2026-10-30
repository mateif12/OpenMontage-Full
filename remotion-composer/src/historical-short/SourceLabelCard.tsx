import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SourceLabel } from "./types";
import { palette, serif, sans } from "./theme";

// On-screen identification of what the viewer is looking at. Every still
// carries one so artworks are never mistaken for photographs or footage.
export const SourceLabelCard: React.FC<{ label: SourceLabel; durationInFrames: number }> = ({
  label,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inStart = Math.round(0.25 * fps);
  const opacity = Math.min(
    interpolate(frame, [inStart, inStart + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const x = interpolate(frame, [inStart, inStart + 16], [-18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        left: 56,
        right: 150, // keep clear of the Shorts top-right controls
        opacity,
        transform: `translateX(${x}px)`,
      }}
    >
      <div
        style={{
          display: "inline-block",
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: 3,
          color: palette.ink,
          background: palette.gold,
          padding: "6px 14px",
          borderRadius: 4,
        }}
      >
        {label.tag}
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: serif,
          fontWeight: 700,
          fontSize: 44,
          lineHeight: 1.12,
          color: palette.parchment,
          textShadow: "0 2px 12px rgba(0,0,0,0.85)",
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
            fontSize: 27,
            lineHeight: 1.3,
            color: palette.parchment,
            opacity: 0.92,
            textShadow: "0 2px 10px rgba(0,0,0,0.9)",
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
            fontWeight: 400,
            fontSize: 21,
            lineHeight: 1.3,
            color: palette.parchment,
            opacity: 0.78,
            textShadow: "0 2px 8px rgba(0,0,0,0.95)",
          }}
        >
          {label.credit}
        </div>
      ) : null}
    </div>
  );
};
