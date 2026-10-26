/**
 * One pulse of light travelling around the loop, with a short tail and an
 * occasional echo behind it. Heat is measured by distance along the curve, so
 * the lit nodes always form a continuous run of bonds rather than a scatter.
 */
import { loopDistance } from "./curve.ts";
import type { LoopLattice } from "./lattice.ts";

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function noise1(value: number): number {
  const i = Math.floor(value);
  const f = value - i;
  const t = f * f * (3 - 2 * f);
  return hash(i) * (1 - t) + hash(i + 1) * t;
}

function fbm(value: number): number {
  return (
    noise1(value) * 0.57 +
    noise1(value * 2.17 + 7.1) * 0.28 +
    noise1(value * 4.61 + 13.7) * 0.15
  );
}

const clamp = (value: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, value));

export interface PulseState {
  phase: number;
}

export class Pulse {
  readonly nodeHeat: Float32Array;
  readonly nodeStrength: Float32Array;
  readonly edgeHeat: Float32Array;
  readonly edgeStrength: Float32Array;
  phase = 0;
  energy = 0.9;
  private lastTime = Number.NaN;

  constructor(private readonly lattice: LoopLattice) {
    this.nodeHeat = new Float32Array(lattice.nodes.length);
    this.nodeStrength = new Float32Array(lattice.nodes.length);
    this.edgeHeat = new Float32Array(lattice.edges.length);
    this.edgeStrength = new Float32Array(lattice.edges.length);
  }

  captureState(): PulseState {
    return { phase: this.phase };
  }

  restore(state: PulseState, seconds: number) {
    this.phase = Number.isFinite(state.phase) ? state.phase : 0;
    this.lastTime = Math.max(0, seconds);
    this.update(this.lastTime);
  }

  update(seconds: number) {
    if (!Number.isFinite(this.lastTime)) {
      this.lastTime = seconds;
    } else {
      const delta = Math.min(0.5, Math.max(0, seconds - this.lastTime));
      this.lastTime = seconds;
      const macro = fbm(seconds * 0.16 + 2.4);
      const surge = fbm(seconds * 0.39 + 11.7);
      const hesitation = clamp((macro - 0.5) / 0.32);
      const rush = clamp((surge - 0.62) / 0.28);
      const speed = clamp(
        0.055 + macro * 0.055 + rush * 0.05 - hesitation * 0.035,
        0.012,
        0.16,
      );
      this.phase = (this.phase + delta * speed) % 1;
    }

    const macro = fbm(seconds * 0.27 + 8.3);
    const tail = 0.052 + macro * 0.03;
    this.energy = clamp(
      0.55 + noise1(seconds * 0.81 + 9.1) * 0.32 + clamp((macro - 0.6) / 0.34) * 0.5,
      0.4,
      1.7,
    );

    const echoGate =
      clamp((noise1(seconds * 0.23 + 31.7) - 0.52) / 0.28) *
      (0.35 + noise1(seconds * 0.67 + 17.4) * 0.65);
    const echoDistance = 0.05 + noise1(seconds * 0.31 + 4.8) * 0.08;
    const echoWidth = 0.012 + noise1(seconds * 0.47 + 29.2) * 0.016;

    const nodes = this.lattice.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const distance = loopDistance(nodes[i].s, this.phase);
      const head = Math.exp(-(distance * distance) / 0.000028);
      const body =
        distance <= tail ? Math.pow(1 - distance / tail, 1.3) * 0.92 : 0;
      const strength = clamp(head + body);
      let heat = Math.max(strength, Math.exp(-distance / (tail * 0.55)) * 0.26);
      if (echoGate > 0.002) {
        const echoDistanceToNode = loopDistance(
          nodes[i].s,
          this.phase - echoDistance,
        );
        const echo = echoGate * Math.exp(-(echoDistanceToNode ** 2) / (echoWidth ** 2));
        heat = Math.max(heat, echo * 0.92);
        this.nodeStrength[i] = Math.max(strength, echo * 0.7);
      } else {
        this.nodeStrength[i] = strength;
      }
      this.nodeHeat[i] = heat;
    }

    const edges = this.lattice.edges;
    for (let i = 0; i < edges.length; i++) {
      const a = edges[i].a;
      const b = edges[i].b;
      this.edgeHeat[i] = Math.max(this.nodeHeat[a], this.nodeHeat[b]);
      this.edgeStrength[i] = Math.max(
        this.nodeStrength[a],
        this.nodeStrength[b],
      );
    }
  }
}
