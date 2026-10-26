# What WebGPU would actually buy this scene

Where things stand. The loop runs on WebGL2 at 1440×900 with DPR 1.75, so the
canvas is 2520×1575. The frame rate is capped at 30, the main thread spends
1.39 ms per frame, and the rest of the 33 ms budget is slack. The GPU accounts
for roughly half of it.

The numbers come from `data/baseline.json`, taken with `scripts/bench-frame.mjs`:
load the page, wait for the canvas, read ten seconds of `Performance.getMetrics`
over CDP, count real frames with a `MutationObserver`. This machine is an M5;
another machine will give different numbers.

## Where the cost actually is

Rule out the usual suspects first.

**Not draw calls.** Three of them: nodes (one InstancedMesh, 644 instances),
bonds (one, 966), the glow points (one). Three draws is nothing in any API.

**Not node count.** Since the crawl moved into the vertex shader, the per-frame
CPU work is a few uniform writes and three submits, measured at 1.39 ms. Remove
all of it and the frame is still 30 fps, because 30 is the cap.

**What is left is pixels.** Each frame renders the scene into RGBA16F at
2520×1575, runs two depth-of-field passes plus a mipmap chain, five downsamples
and five upsamples for bloom, then composites. Around twelve full-screen passes,
each reading and writing the same float attachment.

One RGBA16F target at that size is 2520 × 1575 × 8 bytes, about 31.8 MB. Twelve
passes move hundreds of megabytes through memory. That is the half of the frame.

## Three things WebGPU changes here

**One: tile stores disappear.** Apple GPUs are tile-based: colour stays on chip
until the pass ends and is written back to memory. WebGL2 gives the application
no say in this, so every intermediate attachment is stored and reloaded.
A WebGPU render pass can be marked `storeOp: "discard"` — the intermediate bloom
levels are read by the next pass and never sampled again, so writing them back
is pure waste. Eight or nine of the twelve passes qualify.

At 31.8 MB per attachment, that is 286 MB of traffic avoided. On unified memory
at 150–200 GB/s that is 1.5–2 ms. It sounds small until you remember the whole
frame is 33 ms and this is the expensive end of it.

**Two: bloom can downsample in compute.** Today each level is a full-screen
triangle whose vertex shader does nothing, existing only to trigger the fragment
stage. A compute pass reads 4×4 and writes one pixel, skipping rasterisation
setup and the full-screen triangle. Small in absolute terms, but clean to
implement.

**Three: real GPU timings.** Unrelated to speed, possibly the most valuable part.
WebGL2's `EXT_disjoint_timer_query` is unreliable in Safari and weakened in
Chrome, so we have never had a trustworthy GPU frame time — only "total frame
minus main thread". WebGPU's `timestamp-query` is core and reports per-pass cost
directly. With that, every estimate above can be confirmed or thrown out.

## So how much faster

Honestly: **10–20%**, invisible while the cap is 30.

Adding up the two items above: 1.5–2 ms from bandwidth, a little more from
swapping rasterisation for compute. The rest — pixel shading, metal IBL sampling,
the blur's sample counts — is identical in both APIs. Doubling the frame rate
would mean touching DPR and pass count, which is a different question and can be
done today.

On the other side: with the cap removed, WebGL2 already reaches 60 fps at 1.8 ms
of main thread. Neither API is short of frames. The value of a migration is that
less GPU time means less power, a quieter laptop and a longer battery; that
trustworthy GPU timings make the next optimisation possible; and that it opens
the door to work that really is GPU-shaped, such as generating the lattice
entirely in compute.

## What it costs

**The shaders get rewritten.** `src/scene/material.ts` is a set of
`onBeforeCompile` patches that replace three's `begin_vertex`, `project_vertex`
and `emissivemap_fragment` includes. Node materials have no such hook; the same
effects become `positionNode`, `colorNode` and `emissiveNode` graphs. About 200
lines, including the wear, the micro-scratches, the crawl sampling and the bond
rotation. Not a mechanical translation — a few spots need rethinking.

**Post-processing gets retuned.** Depth of field and bloom exist as nodes in the
WebGPU backend, but the parameters do not carry over. This is where "looks
almost right" happens.

**The bundle grows.** The WebGPU build plus the TSL compiler is roughly 150 kB
gzipped more. It can be kept off the first load with a dynamic import, which the
scene already is.

**Browser coverage.** Stable on desktop Chrome and Edge. Safari and iOS are
**unverified** — the one open fact in this entry. The fallback chain is already
there: `data-renderer` has a slot for `webgpu → webgl2 → static`.

## Next

No migration. A spike first, one day, in two stages:

1. `?renderer=webgpu` selects `WebGPURenderer`, geometry and metal material use
   default node materials, the crawl samples the same LUT through a `texture()`
   node, and **depth of field and bloom stay off**. Measure the bare scene.
2. Turn the post chain back on, add a timestamp query per pass, compare against
   the values inferred on the WebGL2 side.

The gate is written down in advance: at 60 fps, main thread ≤ 1.0 ms and GPU
frame time down ≥ 10%. Miss both and the entry closes here, conclusion included,
without a second week.

Neither stage has been run yet. `status` changes when they have.
