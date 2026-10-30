// Standalone Remotion entry for the historical-short profile. video_compose's
// custom-composition render path (edit_decisions.bespoke.entry) points here so
// the bundle and its doctrine scan cover only this folder.
import React from "react";
import { Composition, registerRoot } from "remotion";
import { HistoricalShort, calculateHistoricalShortMetadata } from "./HistoricalShort";
import { HistoricalShortProps } from "./types";

const HistoricalShortRoot: React.FC = () => (
  <Composition
    id="HistoricalShort"
    component={HistoricalShort}
    durationInFrames={300}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={calculateHistoricalShortMetadata}
    defaultProps={{ durationSeconds: 10, narrationSrc: "", scenes: [], captions: [] } as HistoricalShortProps}
  />
);

registerRoot(HistoricalShortRoot);
