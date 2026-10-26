# Moving the crawl into the vertex shader for 1.1 ms

The hexagons on the loop have always crawled. That used to happen on the CPU:
each frame every node's `s` was shifted by the phase, run through
`positionOnLoop`, then for 966 bonds the midpoint, the direction and a rotation
from +Y onto that direction were computed and written into 1610 matrices and
uploaded. The formula itself was 0.21 ms; the rest was matrices and transfer.

## The move

The curve never moves. Only the phase does. So bake the curve into a texture:

- 2048 samples, each holding a centre point, a normal and a binormal across
  three rows of RGBA16F
- a node only needs `(s, θ, r)` as instance attributes, all constant
- the phase becomes a single `uCrawl` uniform, incremented once per frame

Three lines in the vertex shader produce the position:

```glsl
float u = fract(node.x + uCrawl) + 0.000244140625;
vec3 centre = texture2D(uFrames, vec2(u, 0.125)).xyz;
vec3 normal = texture2D(uFrames, vec2(u, 0.375)).xyz;
vec3 binormal = texture2D(uFrames, vec2(u, 0.625)).xyz;
```

The small constant is half a texel. The texture uses `RepeatWrapping`, so after
`fract` a sample lands exactly on a texel boundary and bilinear filtering mixes
the two ends of the loop, smearing a millimetre of the seam. Half a texel of
offset puts the sample between two texels, weights equal, seam gone.

Bonds are harder: a bond has to look at both ends. Sample the texture twice, then
compute the difference, the length and the rotation in the shader, and stretch a
cylinder along it. `rotationBetween` is Rodrigues' formula; the `c < -0.9999`
branch avoids dividing by zero when the two ends are antiparallel.

The instance matrix now carries rotation and scale only — the position comes from
the shader. `project_vertex` is replaced wholesale: multiply by `instanceMatrix`,
add the curve offset, then project.

## Numbers

| | before | after |
|---|---|---|
| main thread per frame | 2.50 ms | **1.39 ms** |
| of which script | — | 0.93 ms |
| frame rate | 30.0 | 30.0 |
| JS heap | 8–10 MB | 7.3 MB |

1.1 ms saved, against a 33.3 ms budget, under a 30 fps cap. Nobody will see it.

It was still worth doing, for a structural reason. Before, "how many nodes are on
the loop" and "how much work happens each frame" were the same number: add
density, lose speed. Now the per-frame work is one uniform and three draws,
independent of node count. Going from 644 nodes to 2000 barely moves the main
thread.

## Two things that bit

**three caches programs by shader text, and it is easy to fool.** Nodes and bonds
share the `loopPosition` GLSL but not the rest. After the change the bonds
silently picked up the node program, because three's default
`customProgramCacheKey` looks at material type and a few flags, not at injected
text. The symptom: bonds disappeared entirely. One line fixes it:

```ts
material.customProgramCacheKey = () => (uniforms ? `loop-${part}` : "loop-plain");
```

It only reproduces depending on compile order, which is what made it annoying.

**Half floats.** The texture is `HalfFloatType`: linear filtering of float
textures is not guaranteed on phones, half float is core WebGL2. Error at this
scale is about 0.001 world units, a quarter pixel on screen. `FloatType` would
remove it and might be unusable on mobile.

## One note

The page-turn impulse is untouched. `nudge()` still speeds the phase up and eases
it back on the CPU — the GPU only reads. That is a sign the split landed in the
right place: the fast-changing scalar stays on the CPU, the geometry and the
curve stay on the GPU.
