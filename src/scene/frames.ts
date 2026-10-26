/**
 * Where the lens sits, panel by panel, in world units.
 *
 * The loop is about 7.3 units wide, so a window of ±2 units is roughly a
 * quarter of the object. That is the whole idea: no panel shows the mark in
 * full. You get the right lobe, then the left lobe from closer in, then the
 * crossing at arm's length, and only the last panel steps back far enough to
 * suggest what you have been looking at.
 *
 * `zoom` is relative to the distance that fits the whole loop, so 1 is "all of
 * it" and 0.4 is "two and a half times too close".
 */
export interface Frame {
  /** World point the lens is aimed at. */
  x: number;
  y: number;
  zoom: number;
}

/** Half extents of the loop, generous enough for the tube and the tilt. */
export const LOOP_HALF_WIDTH = 3.72;
export const LOOP_HALF_HEIGHT = 1.72;

export const FRAMES: Frame[] = [
  // 01 — the right lobe, running off the right edge of the glass.
  { x: 1.18, y: -0.05, zoom: 0.66 },
  // 02 — the left lobe, closer, so the hexagons are legible.
  { x: -1.62, y: 0.42, zoom: 0.58 },
  // 03 — the crossing, close enough that the two strands read as separate.
  { x: -0.3, y: 0.02, zoom: 0.64 },
  // 04 — pulled back; the mark is almost whole, and still cropped.
  { x: -1.05, y: 0.04, zoom: 0.88 },
];

/** Frame the static image is captured at, so it can stand in for the others. */
export const STILL_FRAME = FRAMES.length - 1;
/** Aspect the static image is captured at. */
export const STILL_ASPECT = 1.6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Framing between two panels. The smoothstep means the lens settles over each
 * panel instead of sliding at a constant rate, which is what makes a horizontal
 * scroll feel like distinct pages rather than one long strip.
 */
export function focusAt(progress: number): Frame {
  const clamped = Math.max(0, Math.min(progress, FRAMES.length - 1));
  const index = Math.floor(clamped);
  const next = Math.min(index + 1, FRAMES.length - 1);
  const raw = clamped - index;
  const t = raw * raw * (3 - 2 * raw);
  const a = FRAMES[index];
  const b = FRAMES[next];
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    zoom: lerp(a.zoom, b.zoom, t),
  };
}
