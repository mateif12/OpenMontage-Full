// Standalone Remotion entry for the landscape historical documentary
// (documentary-montage historical profile, 1920x1080). video_compose's
// custom-composition path (edit_decisions.bespoke.entry) renders from here.
import React from "react";
import { Composition, registerRoot } from "remotion";
import { HistoricalDocumentary, calculateHistoricalDocumentaryMetadata } from "./HistoricalDocumentary";
import { HistoricalDocumentaryProps } from "./types";

const Root: React.FC = () => (
  <Composition
    id="HistoricalDocumentary"
    component={HistoricalDocumentary}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
    calculateMetadata={calculateHistoricalDocumentaryMetadata}
    defaultProps={{ durationSeconds: 10, narrationSrc: "", scenes: [], captions: [] } as HistoricalDocumentaryProps}
  />
);

registerRoot(Root);
