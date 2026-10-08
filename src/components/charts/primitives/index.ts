// Generic chart primitives (docs/spec/02 DS-CHARTS). Screen-specific charts (EVM S-curve, Gantt, heatmaps…)
// are built by their screen owners on top of these.
export { linear, fx, linePath, areaPath, evmGrid, trendFrame, sparkPath, trendDelta, timelinePct } from './geometry';
export type { Margins } from './geometry';
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { ChartFrame, HGrid, XLabels, AreaGradient, PointMarker } from './Frame';
export type { ChartFrameProps, HGridProps, XLabelsProps } from './Frame';
export { DotRating } from './DotRating';
export type { DotRatingProps } from './DotRating';
