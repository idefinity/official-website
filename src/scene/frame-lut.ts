/**
 * The curve, baked once into a texture so the vertex shader can do the crawl.
 *
 * Row 0 is the centre point, row 1 the normal, row 2 the binormal — every sample
 * of `frameAt` along the loop. Half floats because a float texture can only be
 * filtered with a linear extension that phones do not always advertise, while
 * half-float filtering is core WebGL2. The precision loss at this scale is
 * around 0.001 units, a quarter of a pixel on screen.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
} from "three";
import { frameAt, parameterAt } from "./curve.ts";

/** Samples around the loop. 2048 keeps the interpolation error under a tenth of a millimetre. */
export const FRAME_SAMPLES = 2048;
const ROWS = 4;

export function buildFrameTexture(): DataTexture {
  const data = new Uint16Array(FRAME_SAMPLES * ROWS * 4);
  const put = (row: number, i: number, value: readonly number[]) => {
    const offset = (row * FRAME_SAMPLES + i) * 4;
    data[offset] = DataUtils.toHalfFloat(value[0]);
    data[offset + 1] = DataUtils.toHalfFloat(value[1]);
    data[offset + 2] = DataUtils.toHalfFloat(value[2]);
    data[offset + 3] = DataUtils.toHalfFloat(1);
  };
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const frame = frameAt(parameterAt(i / FRAME_SAMPLES));
    put(0, i, frame.point);
    put(1, i, frame.normal);
    put(2, i, frame.binormal);
  }
  const texture = new DataTexture(data, FRAME_SAMPLES, ROWS, undefined, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
