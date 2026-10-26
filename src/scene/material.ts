import { MeshStandardMaterial, type Texture } from "three";

/**
 * Polished metal with a little surface history. The environment map does the
 * lighting; the shader only adds wear, micro-scratches and the heat that the
 * travelling pulse leaves behind. Nothing is painted emissive while it is cold,
 * which is why the idle lattice reads as real metal rather than a glowing prop.
 *
 * The crawl lives here too. Every vertex asks the baked frame texture where its
 * node sits for the current phase, so a page turn costs one uniform instead of
 * 1 610 matrix writes.
 */
export interface LoopUniforms {
  uFrames: { value: Texture | null };
  uCrawl: { value: number };
  uSway: { value: number };
}

export type LoopPart = "node" | "bond";

/** Where a node sits on the tube: a point, a normal, a binormal, and the phase. */
const curveLookup = `
uniform sampler2D uFrames;
uniform float uCrawl;
uniform float uSway;
vec3 loopPosition(vec3 node) {
  float u = fract(node.x + uCrawl) + 0.000244140625;
  float angle = node.y * 6.283185307179586;
  vec3 centre = texture2D(uFrames, vec2(u, 0.125)).xyz;
  vec3 normal = texture2D(uFrames, vec2(u, 0.375)).xyz;
  vec3 binormal = texture2D(uFrames, vec2(u, 0.625)).xyz;
  return centre + (normal * cos(angle) + binormal * sin(angle)) * (node.z + uSway);
}
`;

const rotationBetween = `
mat3 rotationBetween(vec3 from, vec3 to) {
  float c = dot(from, to);
  if (c < -0.9999) return mat3(1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -1.0);
  vec3 v = cross(from, to);
  mat3 skew = mat3(0.0, v.z, -v.y, -v.z, 0.0, v.x, v.y, -v.x, 0.0);
  return mat3(1.0) + skew + skew * skew / (1.0 + c);
}
`;

export function metalMaterial(
  mobile = false,
  part: LoopPart = "node",
  uniforms?: LoopUniforms,
) {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 1,
    transparent: true,
    envMapIntensity: mobile ? 0.95 : 1.0,
  });

  const colorDetail = mobile
    ? "float surface = clamp(vSurface, 0.0, 1.0);\n" +
      "float grain = sin(surface * 83.0 + 1.7) * 0.5 + 0.5;\n" +
      "float wearPatch = smoothstep(0.48, 0.9, grain);\n" +
      "float scratch = smoothstep(0.76, 0.98, 1.0 - grain);\n" +
      "float dust = smoothstep(0.7, 0.98, sin(surface * 17.0 + 4.0) * 0.5 + 0.5);\n" +
      "diffuseColor.rgb *= 0.9 + surface * 0.1;\n" +
      "diffuseColor.rgb *= 1.0 - scratch * 0.035 - dust * 0.02;\n"
    : "float surface = clamp(vSurface, 0.0, 1.0);\n" +
      "float wearPatch = smoothstep(0.54, 0.9, sin(vMaterialPosition.x * 5.1 + vMaterialPosition.y * 3.7 + vMaterialPosition.z * 4.3 + surface * 1.7) * 0.5 + 0.5);\n" +
      "float scratch = smoothstep(0.76, 0.98, sin(vMaterialPosition.y * 220.0 + vMaterialPosition.z * 170.0 + surface * 13.0) * 0.5 + 0.5);\n" +
      "float dust = smoothstep(0.72, 0.98, sin(vMaterialPosition.x * 180.0 + vMaterialPosition.z * 150.0 + surface * 9.0) * 0.5 + 0.5);\n" +
      "diffuseColor.rgb *= 0.9 + surface * 0.1;\n" +
      "diffuseColor.rgb *= 1.0 - scratch * 0.04 - dust * 0.02;\n";

  material.onBeforeCompile = (shader) => {
    if (uniforms) {
      shader.uniforms.uFrames = uniforms.uFrames;
      shader.uniforms.uCrawl = uniforms.uCrawl;
      shader.uniforms.uSway = uniforms.uSway;
    }
    const instanced =
      part === "node"
        ? "attribute vec3 aNode;\nattribute vec3 aJitter;\nattribute float instanceSignal;\n"
        : "attribute vec3 aA;\nattribute vec3 aB;\nattribute float aBondRadius;\n";
    shader.vertexShader =
      instanced +
      (uniforms ? curveLookup + (part === "bond" ? rotationBetween : "") : "") +
      "attribute float instanceFade;\n" +
      "attribute float instanceHeat;\n" +
      "attribute float instanceSurface;\n" +
      "varying float vFade;\n" +
      "varying float vHeat;\n" +
      "varying float vSurface;\n" +
      (mobile ? "" : "varying vec3 vMaterialPosition;\n") +
      shader.vertexShader;

    if (uniforms && part === "node") {
      // The instance matrix carries rotation and scale only; where the node sits
      // comes from the curve, so it can move without touching a buffer.
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        "void main() {\nvec3 vLoopOffset = loopPosition(aNode) + aJitter;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "vec4 mvPosition = vec4( transformed, 1.0 );\n" +
          "#ifdef USE_INSTANCING\n" +
          "mvPosition = instanceMatrix * mvPosition;\n" +
          "#endif\n" +
          "mvPosition.xyz += vLoopOffset;\n" +
          "mvPosition = modelViewMatrix * mvPosition;\n" +
          "gl_Position = projectionMatrix * mvPosition;",
      );
    }

    if (uniforms && part === "bond") {
      // A bond has to look at both of its ends, so the whole matrix is built
      // here: midpoint, direction, and a rotation from +Y onto that direction.
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        "void main() {\n" +
          "vec3 loopA = loopPosition(aA);\n" +
          "vec3 loopB = loopPosition(aB);\n" +
          "vec3 loopAxis = loopB - loopA;\n" +
          "float vLoopLength = max(length(loopAxis), 0.0001);\n" +
          "mat3 vLoopRotation = rotationBetween(vec3(0.0, 1.0, 0.0), loopAxis / vLoopLength);\n" +
          "vec3 vLoopMid = (loopA + loopB) * 0.5;",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        "vec3 objectNormal = vLoopRotation * vec3( normal );",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "float bondRadius = aBondRadius + instanceHeat * 0.0016;\n" +
          "vec3 transformed = vLoopMid + vLoopRotation * vec3(\n" +
          "  position.x * bondRadius,\n" +
          "  position.y * vLoopLength,\n" +
          "  position.z * bondRadius);\n" +
          "vFade = instanceFade;\n" +
          "vHeat = instanceHeat;\n" +
          "vSurface = instanceSurface;\n" +
          (mobile ? "" : "vMaterialPosition = transformed;"),
      );
    }

    if (!uniforms || part === "node") {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" +
          (uniforms
            ? // The pulse swells a node as it passes. Those two scale terms used
              // to be baked into a matrix rebuilt every frame; now they ride on
              // attributes that were being uploaded anyway.
              "transformed *= 1.0 + instanceHeat * 0.0326 + instanceSignal * 0.087;\n"
            : "") +
          "vFade = instanceFade;\nvHeat = instanceHeat;\nvSurface = instanceSurface;" +
          (mobile ? "" : "\nvMaterialPosition = transformed;"),
      );
    }
    shader.fragmentShader =
      "varying float vFade;\n" +
      "varying float vHeat;\n" +
      "varying float vSurface;\n" +
      (mobile ? "" : "varying vec3 vMaterialPosition;\n") +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n" +
        colorDetail +
        "diffuseColor.a *= vFade;\n" +
        "if(diffuseColor.a < 0.003) discard;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\n" +
        "roughnessFactor = clamp(roughnessFactor * (0.86 + surface * 0.28) + scratch * 0.035 + wearPatch * 0.025, 0.16, 0.3);",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      "#include <metalnessmap_fragment>\n" +
        "metalnessFactor = clamp(metalnessFactor - wearPatch * 0.025, 0.96, 1.0);",
    );
    if (!mobile) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\n" +
          "normal = normalize(normal + vec3(sin(vMaterialPosition.y * 41.0 + surface * 3.0), sin(vMaterialPosition.z * 53.0 + surface * 5.0), sin(vMaterialPosition.x * 37.0 + surface * 7.0)) * (0.004 + scratch * 0.006));",
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n" +
        "float heat = clamp(vHeat, 0.0, 1.6);\n" +
        "float hot = smoothstep(0.38, 1.1, heat);\n" +
        "float white = smoothstep(0.92, 1.32, heat);\n" +
        "vec3 ember = vec3(0.52, 0.075, 0.012);\n" +
        "vec3 amber = vec3(1.0, 0.34, 0.035);\n" +
        "vec3 hotColor = mix(ember, amber, hot);\n" +
        "hotColor = mix(hotColor, vec3(1.0, 0.95, 0.78), white);\n" +
        "totalEmissiveRadiance += hotColor * pow(heat, 1.45) * (0.75 + white * 1.05);\n" +
        "totalEmissiveRadiance += vec3(0.3, 0.02, 0.0) * pow(heat, 3.0) * 0.7;",
    );
  };
  // Node and bond shaders share the text of this function, and three keys its
  // program cache on that text. Without an explicit key the second one silently
  // reuses the first one's program.
  material.customProgramCacheKey = () =>
    uniforms ? `loop-${part}` : "loop-plain";

  return material;
}
