import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  PointLight,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { TUBE_RADIUS, positionOnLoop } from "./curve.ts";
import { buildFrameTexture } from "./frame-lut.ts";
import { buildLoopLattice, type LoopLattice } from "./lattice.ts";
import { metalMaterial, type LoopUniforms } from "./material.ts";
import { Pulse, type PulseState } from "./pulse.ts";
import type { Quality } from "./quality.ts";

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

/**
 * How fast the lattice itself travels, in turns of the loop per second. The
 * hexagons are the moving part — the curve, the tube and the framing all stay
 * put — so the figure crawls without changing shape.
 *
 * A rigid shift is safe because `s` is circular: every pair of nodes keeps the
 * distance it had, so no hexagon tears open where `s` wraps past 1.
 */
const CRAWL_SPEED = 0.034;
/** A page turn runs the pattern up to this many times faster. */
const CRAWL_BOOST = 3;
/** How quickly that extra speed bleeds off, per second. */
const BOOST_DECAY = 3.2;
/**
 * How fast the crawl speed chases its target, per second. Slow next to the
 * decay above and the impulse never arrives — the curve is cut off at 2.4x
 * instead of the 3.4x it is aiming for.
 */
const CRAWL_EASE = 18;

export interface LoopMeshState {
  pulse: PulseState;
  rotation: [number, number, number];
  angularVelocity: [number, number, number];
  crawl: number;
  crawlSpeed: number;
}

export class LoopMesh {
  readonly group = new Group();
  readonly lattice: LoopLattice;
  private readonly pulse: Pulse;
  private readonly nodes: InstancedMesh;
  private readonly bonds: InstancedMesh;
  private readonly halo: Points<BufferGeometry, ShaderMaterial>;
  private readonly nodeFade: InstancedBufferAttribute;
  private readonly bondFade: InstancedBufferAttribute;
  private readonly nodeHeat: InstancedBufferAttribute;
  private readonly bondHeat: InstancedBufferAttribute;
  private readonly nodeSignal: InstancedBufferAttribute;
  private readonly nodeSurface: InstancedBufferAttribute;
  private readonly bondSurface: InstancedBufferAttribute;
  /** The curve as a texture; the shaders read their positions out of it. */
  private readonly frames = buildFrameTexture();
  private readonly uniforms: LoopUniforms = {
    uFrames: { value: null },
    uCrawl: { value: 0 },
    uSway: { value: 0 },
  };
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private readonly metal = new Color("#666f75");
  private readonly gold = new Color("#f0bf5e");
  private readonly ember = new Color("#a83b13");
  private readonly pulseLight: PointLight;
  private readonly rotation = new Vector3(-0.1, 0.28, -0.05);
  private readonly angularVelocity = new Vector3();
  private readonly radii: Float32Array;
  private readonly mobile: boolean;
  private lastSeconds = 0;
  /** Where the pattern currently sits along the loop, in turns. */
  private crawl = 0;
  private crawlSpeed = CRAWL_SPEED;
  /** Leftover speed from the last page turn; decays back to zero. */
  private boost = 0;

  /** Read by the page-level test hook. */
  get crawlPhase(): number {
    return this.crawl;
  }

  /** Turns per second right now, including any leftover page-turn boost. */
  get crawlRate(): number {
    return this.crawlSpeed;
  }

  /**
   * A page turn. Not a kick to the shape — the speed picks up for about a
   * second and eases back, which is the whole tell that the thing is alive.
   */
  nudge(strength = 1) {
    this.boost = Math.min(1.5, this.boost + strength);
  }

  constructor(quality: Quality) {
    this.mobile = quality.mobile;
    this.lattice = buildLoopLattice(quality.columns, quality.rows);
    this.pulse = new Pulse(this.lattice);
    this.radii = Float32Array.from({ length: this.lattice.nodes.length }, (_, i) =>
      TUBE_RADIUS * (0.985 + hash(i * 3.77 + 4.1) * 0.03),
    );
    this.uniforms.uFrames.value = this.frames;

    const sphere = new SphereGeometry(
      1,
      quality.sphereSegments,
      quality.mobile ? 6 : 8,
    );
    const cylinder = new CylinderGeometry(1, 1, 1, quality.bondSegments, 1);
    const nodeCount = this.lattice.nodes.length;
    const bondCount = this.lattice.edges.length;

    this.nodeFade = new InstancedBufferAttribute(new Float32Array(nodeCount), 1)
      .setUsage(DynamicDrawUsage);
    this.bondFade = new InstancedBufferAttribute(new Float32Array(bondCount), 1)
      .setUsage(DynamicDrawUsage);
    this.nodeHeat = new InstancedBufferAttribute(new Float32Array(nodeCount), 1)
      .setUsage(DynamicDrawUsage);
    this.bondHeat = new InstancedBufferAttribute(new Float32Array(bondCount), 1)
      .setUsage(DynamicDrawUsage);
    this.nodeSignal = new InstancedBufferAttribute(new Float32Array(nodeCount), 1)
      .setUsage(DynamicDrawUsage);
    this.nodeSurface = new InstancedBufferAttribute(new Float32Array(nodeCount), 1);
    this.bondSurface = new InstancedBufferAttribute(new Float32Array(bondCount), 1);
    for (let i = 0; i < nodeCount; i++) {
      this.nodeSurface.setX(i, hash(i * 5.37 + 1.2));
    }
    for (let i = 0; i < bondCount; i++) {
      this.bondSurface.setX(i, hash(i * 4.91 + 8.7));
    }

    // (s, theta, radius) per node, and the off-lattice offset that keeps the
    // figure from reading as a drafting exercise. Both fixed for the lifetime of
    // the mesh; the phase that moves them lives in a uniform.
    const nodeData = new Float32Array(nodeCount * 3);
    const jitterData = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      const node = this.lattice.nodes[i];
      nodeData.set([node.s, node.theta, this.radii[i]], i * 3);
      jitterData.set(
        [
          (hash(i * 1.7) - 0.5) * 0.012,
          (hash(i * 2.3 + 5) - 0.5) * 0.012,
          (hash(i * 3.1 + 9) - 0.5) * 0.01,
        ],
        i * 3,
      );
    }
    const nodePosition = new InstancedBufferAttribute(nodeData, 3);
    const nodeJitter = new InstancedBufferAttribute(jitterData, 3);

    // Both ends of every bond, plus the radius that the surface hash picks.
    const bondA = new InstancedBufferAttribute(new Float32Array(bondCount * 3), 3);
    const bondB = new InstancedBufferAttribute(new Float32Array(bondCount * 3), 3);
    const bondRadius = new InstancedBufferAttribute(new Float32Array(bondCount), 1);
    for (let i = 0; i < bondCount; i++) {
      const { a, b } = this.lattice.edges[i];
      const start = this.lattice.nodes[a];
      const end = this.lattice.nodes[b];
      bondA.setXYZ(i, start.s, start.theta, this.radii[a]);
      bondB.setXYZ(i, end.s, end.theta, this.radii[b]);
      bondRadius.setX(
        i,
        (0.0175 + this.bondSurface.getX(i) * 0.0038) * (this.mobile ? 1.05 : 1),
      );
    }

    sphere.setAttribute("aNode", nodePosition);
    sphere.setAttribute("aJitter", nodeJitter);
    sphere.setAttribute("instanceFade", this.nodeFade);
    sphere.setAttribute("instanceHeat", this.nodeHeat);
    sphere.setAttribute("instanceSignal", this.nodeSignal);
    sphere.setAttribute("instanceSurface", this.nodeSurface);
    cylinder.setAttribute("aA", bondA);
    cylinder.setAttribute("aB", bondB);
    cylinder.setAttribute("aBondRadius", bondRadius);
    cylinder.setAttribute("instanceFade", this.bondFade);
    cylinder.setAttribute("instanceHeat", this.bondHeat);
    cylinder.setAttribute("instanceSurface", this.bondSurface);

    this.nodes = new InstancedMesh(
      sphere,
      metalMaterial(quality.mobile, "node", this.uniforms),
      nodeCount,
    );
    this.bonds = new InstancedMesh(
      cylinder,
      metalMaterial(quality.mobile, "bond", this.uniforms),
      bondCount,
    );
    this.nodes.frustumCulled = this.bonds.frustumCulled = false;
    this.layout();

    const glowGeometry = new BufferGeometry();
    glowGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(nodeCount * 3), 3),
    );
    // A non-instanced Points draw cannot read an InstancedBufferAttribute, so
    // the glow gets its own copy of the same two arrays.
    glowGeometry.setAttribute("aNode", new BufferAttribute(nodeData.slice(), 3));
    glowGeometry.setAttribute("aJitter", new BufferAttribute(jitterData.slice(), 3));
    glowGeometry.setAttribute(
      "strength",
      new BufferAttribute(new Float32Array(nodeCount), 1).setUsage(
        DynamicDrawUsage,
      ),
    );
    glowGeometry.setAttribute(
      "heat",
      new BufferAttribute(new Float32Array(nodeCount), 1).setUsage(
        DynamicDrawUsage,
      ),
    );
    const glowMaterial = new ShaderMaterial({
      uniforms: {
        pixelRatio: { value: quality.pixelRatio },
        uFrames: this.uniforms.uFrames,
        uCrawl: this.uniforms.uCrawl,
        uSway: this.uniforms.uSway,
      },
      vertexShader: `attribute vec3 aNode;
        attribute vec3 aJitter;
        attribute float strength;
        attribute float heat;
        uniform sampler2D uFrames;
        uniform float uCrawl;
        uniform float uSway;
        uniform float pixelRatio;
        varying float vStrength;
        varying float vHeat;
        vec3 loopPosition(vec3 node) {
          float u = fract(node.x + uCrawl) + 0.000244140625;
          float angle = node.y * 6.283185307179586;
          vec3 centre = texture2D(uFrames, vec2(u, 0.125)).xyz;
          vec3 normal = texture2D(uFrames, vec2(u, 0.375)).xyz;
          vec3 binormal = texture2D(uFrames, vec2(u, 0.625)).xyz;
          return centre + (normal * cos(angle) + binormal * sin(angle)) * (node.z + uSway);
        }
        void main() {
          vStrength = strength;
          vHeat = heat;
          vec4 view = modelViewMatrix * vec4(loopPosition(aNode) + aJitter, 1.0);
          gl_Position = projectionMatrix * view;
          float size = 58.0 + 74.0 * clamp(heat, 0.0, 1.4);
          gl_PointSize = min(66.0, size * pixelRatio / max(1.0, -view.z));
        }`,
      fragmentShader: `varying float vStrength;
        varying float vHeat;
        void main() {
          float d = length(gl_PointCoord - .5) * 2.0;
          float core = exp(-d * d * 10.0);
          float halo = exp(-d * d * 3.2) * (1.0 - smoothstep(.68, 1.0, d));
          float hot = smoothstep(.62, 1.2, vHeat);
          vec3 color = mix(vec3(1.0, .18, .018), vec3(1.0, .66, .16), smoothstep(.04, .72, vHeat));
          color = mix(color, vec3(1.0, .94, .76), hot);
          float alpha = (core * .78 + halo * .56) * vStrength * (.55 + hot * .8);
          gl_FragColor = vec4(color * (1.0 + hot * .75), alpha * .46);
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Points(glowGeometry, glowMaterial);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 2;
    this.pulseLight = new PointLight(0xffa34a, 0, 3.4, 2);
    this.group.add(this.bonds, this.nodes, this.halo, this.pulseLight);
    this.update(0);
  }

  /**
   * Everything that does not change per frame: which way each node is turned,
   * how big it is, and where each bond's two ends are. Bonds get an identity
   * matrix — their geometry is built in the vertex shader from the curve.
   */
  private layout() {
    const quaternion = new Quaternion();
    const euler = new Object3D();
    const identity = new Matrix4();
    for (let i = 0; i < this.lattice.nodes.length; i++) {
      const surface = this.nodeSurface.getX(i);
      const scale =
        (0.042 + surface * 0.004) * (this.mobile ? 1.1 : 1);
      euler.rotation.set(
        (hash(i * 2.11 + 1) - 0.5) * 0.7,
        (hash(i * 3.17 + 7) - 0.5) * 0.7,
        (hash(i * 4.23 + 13) - 0.5) * 0.7,
      );
      quaternion.setFromEuler(euler.rotation);
      this.transform.position.set(0, 0, 0);
      this.transform.quaternion.copy(quaternion);
      this.transform.scale.set(
        scale * (0.9 + surface * 0.08),
        scale * (0.94 + surface * 0.05),
        scale * (0.88 + surface * 0.1),
      );
      this.transform.updateMatrix();
      this.nodes.setMatrixAt(i, this.transform.matrix);
    }
    for (let i = 0; i < this.lattice.edges.length; i++) {
      this.bonds.setMatrixAt(i, identity);
    }
    this.nodes.instanceMatrix.needsUpdate = true;
    this.bonds.instanceMatrix.needsUpdate = true;
    this.transform.rotation.set(0, 0, 0);
  }

  update(seconds: number) {
    const time = Math.max(0, seconds);
    const delta = Math.min(0.08, Math.max(0, time - this.lastSeconds));
    this.lastSeconds = time;
    this.pulse.update(time);

    // The pattern crawls at a steady rate; a page turn leaves an impulse that
    // runs it faster and then bleeds away.
    this.boost *= Math.exp(-BOOST_DECAY * delta);
    const crawlTarget = CRAWL_SPEED * (1 + this.boost * CRAWL_BOOST);
    this.crawlSpeed +=
      (crawlTarget - this.crawlSpeed) * Math.min(1, delta * CRAWL_EASE);
    this.crawl = (this.crawl + this.crawlSpeed * delta) % 1;

    // A slow turn, damped like a heavy object, plus a little breathing drag.
    const targetX = -0.1 + (fbm(time * 0.032 + 4.3) - 0.5) * 0.05;
    const targetY = 0.28 + (fbm(time * 0.026 + 18.1) - 0.5) * 0.07;
    const targetZ = -0.05 + (fbm(time * 0.021 + 31.7) - 0.5) * 0.03;
    const decay = Math.exp(-3.2 * delta);
    this.angularVelocity.x =
      (this.angularVelocity.x + (targetX - this.rotation.x) * 6 * delta) * decay;
    this.angularVelocity.y =
      (this.angularVelocity.y + (targetY - this.rotation.y) * 6 * delta) * decay;
    this.angularVelocity.z =
      (this.angularVelocity.z + (targetZ - this.rotation.z) * 6 * delta) * decay;
    this.rotation.addScaledVector(this.angularVelocity, delta);
    this.group.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z);

    // The whole crawl, and the breathing radius, are two numbers now.
    this.uniforms.uCrawl.value = this.crawl;
    this.uniforms.uSway.value = Math.sin(time * 0.23) * 0.0045;

    const strengths = this.halo.geometry.getAttribute("strength") as BufferAttribute;
    const heats = this.halo.geometry.getAttribute("heat") as BufferAttribute;

    for (let i = 0; i < this.lattice.nodes.length; i++) {
      const surface = this.nodeSurface.getX(i);
      const signal = clamp(this.pulse.nodeStrength[i]);
      const heat = clamp(this.pulse.nodeHeat[i], 0, 1.6);
      const tint = 0.78 + surface * 0.22;
      this.color
        .copy(this.metal)
        .multiplyScalar(tint)
        .lerp(this.gold, clamp(signal * 0.82 + heat * 0.18));
      this.color.lerp(this.ember, clamp((heat - signal) * 0.22, 0, 0.32));
      this.nodes.setColorAt(i, this.color);
      this.nodeHeat.setX(i, heat);
      this.nodeSignal.setX(i, signal);
      this.nodeFade.setX(i, 1);
      strengths.setX(i, heat * (0.65 + signal * 0.55));
      heats.setX(i, heat);
    }

    for (let i = 0; i < this.lattice.edges.length; i++) {
      const surface = this.bondSurface.getX(i);
      const edgeSignal = clamp(this.pulse.edgeStrength[i]);
      const edgeHeat = clamp(this.pulse.edgeHeat[i], 0, 1.6);
      const tint = 0.75 + surface * 0.25;
      this.color
        .copy(this.metal)
        .multiplyScalar(tint)
        .lerp(this.gold, clamp(edgeSignal * 0.78 + edgeHeat * 0.24));
      this.color.lerp(this.ember, clamp((edgeHeat - edgeSignal) * 0.24, 0, 0.34));
      this.bonds.setColorAt(i, this.color);
      this.bondHeat.setX(i, edgeHeat);
      this.bondFade.setX(i, 1);
    }

    this.nodes.instanceColor!.needsUpdate = true;
    this.bonds.instanceColor!.needsUpdate = true;
    this.nodeFade.needsUpdate = this.bondFade.needsUpdate = true;
    this.nodeHeat.needsUpdate = this.bondHeat.needsUpdate = true;
    this.nodeSignal.needsUpdate = true;
    strengths.needsUpdate = heats.needsUpdate = true;

    const head = positionOnLoop(this.pulse.phase + this.crawl, 0.22, this.radii[0]);
    this.pulseLight.position.set(head[0], head[1], head[2]);
    this.pulseLight.distance = this.mobile ? 1.6 : 1.9;
    this.pulseLight.intensity =
      (this.mobile ? 0.8 : 1.05) * clamp(this.pulse.energy, 0, 1.8);
  }

  setPixelRatio(pixelRatio: number) {
    this.halo.material.uniforms.pixelRatio.value = pixelRatio;
  }

  captureState(): LoopMeshState {
    return {
      pulse: this.pulse.captureState(),
      rotation: [this.rotation.x, this.rotation.y, this.rotation.z],
      angularVelocity: [
        this.angularVelocity.x,
        this.angularVelocity.y,
        this.angularVelocity.z,
      ],
      crawl: this.crawl,
      crawlSpeed: this.crawlSpeed,
    };
  }

  restoreState(state: LoopMeshState, seconds: number) {
    this.rotation.set(...state.rotation);
    this.angularVelocity.set(...state.angularVelocity);
    this.crawl = state.crawl;
    this.crawlSpeed = state.crawlSpeed;
    this.lastSeconds = Math.max(0, seconds);
    this.pulse.restore(state.pulse, this.lastSeconds);
    this.update(this.lastSeconds);
  }

  dispose() {
    for (const mesh of [this.nodes, this.bonds, this.halo]) {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    }
    this.nodes.dispose();
    this.bonds.dispose();
    this.frames.dispose();
    this.group.clear();
  }
}
