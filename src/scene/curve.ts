/**
 * The loop behind the hero: a Gerono lemniscate lifted out of the plane so the
 * two strands pass each other instead of intersecting. It reads as an infinity
 * mark from the front and as a real 3D object from three quarters.
 *
 * Everything downstream addresses the curve by `s` in [0, 1) — arc length, not
 * the raw parameter. The raw parameter bunches the lattice up near the crossing,
 * where the curve moves fastest.
 */

export const TUBE_RADIUS = 0.46;

const A = 3.18;
const B = 1.66;
// The two strands cross the middle at the same (x, y). Lifting one above the
// other by this much is what keeps them from merging into one blur; the depth
// also gives the focus pass something to work with.
const LIFT = 1.05;
const TAU = Math.PI * 2;
const SAMPLES = 1536;

const wrapIndex = (value: number) => ((value % 1) + 1) % 1;

export function curvePoint(t: number): [number, number, number] {
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [A * cos, B * sin * cos, LIFT * sin];
}

function distance(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const arc = new Float64Array(SAMPLES + 1);
{
  let previous = curvePoint(0);
  for (let i = 1; i <= SAMPLES; i++) {
    const point = curvePoint((i / SAMPLES) * TAU);
    arc[i] = arc[i - 1] + distance(point, previous);
    previous = point;
  }
}

export const LOOP_LENGTH = arc[SAMPLES];

/** Raw curve parameter at arc-length fraction `s`. */
export function parameterAt(s: number): number {
  const target = wrapIndex(s) * LOOP_LENGTH;
  let low = 0;
  let high = SAMPLES;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (arc[middle] < target) low = middle;
    else high = middle;
  }
  const span = arc[high] - arc[low] || 1;
  const fraction = (target - arc[low]) / span;
  return ((low + fraction) / SAMPLES) * TAU;
}

export interface CurveFrame {
  point: [number, number, number];
  normal: [number, number, number];
  binormal: [number, number, number];
}

const WORLD_UP: [number, number, number] = [0, 1, 0];

/**
 * A swept frame referenced to world up rather than the Frenet frame. The Frenet
 * normal flips sign where the curve changes its bending direction, which would
 * tear the hexagons apart at the crossing.
 */
export function frameAt(t: number): CurveFrame {
  const step = 0.0015;
  const before = curvePoint(t - step);
  const after = curvePoint(t + step);
  const point = curvePoint(t);
  const tangent: [number, number, number] = [
    after[0] - before[0],
    after[1] - before[1],
    after[2] - before[2],
  ];
  const length = Math.hypot(...tangent) || 1;
  const tx = tangent[0] / length;
  const ty = tangent[1] / length;
  const tz = tangent[2] / length;

  let nx = WORLD_UP[1] * tz - WORLD_UP[2] * ty;
  let ny = WORLD_UP[2] * tx - WORLD_UP[0] * tz;
  let nz = WORLD_UP[0] * ty - WORLD_UP[1] * tx;
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength < 1e-5) {
    nx = 1;
    ny = 0;
    nz = 0;
  } else {
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
  }
  const bx = ty * nz - tz * ny;
  const by = tz * nx - tx * nz;
  const bz = tx * ny - ty * nx;
  return { point, normal: [nx, ny, nz], binormal: [bx, by, bz] };
}

/**
 * A node sits on the tube surface at `s` along the loop and `theta` around it.
 * `theta` is a fraction of a turn, so the lattice generator can wrap it without
 * knowing anything about the curve.
 */
export function positionOnLoop(
  s: number,
  theta: number,
  radius = TUBE_RADIUS,
): [number, number, number] {
  const { point, normal, binormal } = frameAt(parameterAt(s));
  const angle = theta * TAU;
  const cos = Math.cos(angle) * radius;
  const sin = Math.sin(angle) * radius;
  return [
    point[0] + normal[0] * cos + binormal[0] * sin,
    point[1] + normal[1] * cos + binormal[1] * sin,
    point[2] + normal[2] * cos + binormal[2] * sin,
  ];
}

/** Shortest distance between two points on the loop, measured in turns. */
export function loopDistance(a: number, b: number): number {
  const delta = Math.abs(wrapIndex(a) - wrapIndex(b));
  return Math.min(delta, 1 - delta);
}

export function wrap(value: number): number {
  return wrapIndex(value);
}
