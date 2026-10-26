/**
 * Quality tiers. Cell counts follow the tube radius so the hexagons stay about
 * as wide as they are long; a fixed count would stretch them into rods.
 */
import { LOOP_LENGTH, TUBE_RADIUS } from "./curve.ts";

export interface Quality {
  mobile: boolean;
  columns: number;
  rows: number;
  nodeScale: number;
  bondScale: number;
  sphereSegments: number;
  bondSegments: number;
  pixelRatio: number;
  fps: number;
}

const CIRCUMFERENCE = Math.PI * 2 * TUBE_RADIUS;

export function qualityFor(width: number, pixelRatio: number): Quality {
  const mobile = width <= 760;
  const rows = mobile ? 6 : 7;
  // One cell along the loop should measure about one cell around the tube.
  // Rounded to an even count: the honeycomb's brick offset only repeats every
  // two columns, so an odd count leaves a seam of half-welded atoms.
  const columns = Math.max(
    4,
    Math.round(
      (LOOP_LENGTH * Math.sqrt(3) * rows) / (CIRCUMFERENCE * 1.5) / 2,
    ) * 2,
  );
  return {
    mobile,
    columns,
    rows,
    nodeScale: mobile ? 0.9 : 0.86,
    bondScale: mobile ? 0.92 : 0.9,
    sphereSegments: mobile ? 8 : 12,
    bondSegments: mobile ? 5 : 8,
    pixelRatio: Math.min(pixelRatio, mobile ? 1.35 : 1.75),
    fps: mobile ? 24 : 30,
  };
}
