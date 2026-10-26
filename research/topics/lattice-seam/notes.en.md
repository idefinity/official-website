# Why the honeycomb would not close

The eye found it first. Zoomed in on the tube, a few spheres carried two bonds
instead of three, and pairs of them read as one sphere sitting on another. The
pattern crawls, so it only came past the camera every so often.

## Which layer is at fault

Rendering faults have recognisable shapes: z-fighting stripes, black faces from
flipped normals, instances jumping because a matrix was written wrong. Not this.
The spheres are where they belong, the bonds are where they belong, and some
bonds are **missing**.

So look at topology. The lattice tiles a torus with hexagons: `columns` along the
loop, `rows` around the tube. The brick offset repeats every two columns — column
`i` shifts half a cell around the tube when `i` is odd. That pattern's period
along the loop is `1.5 × columns`, and the shift is only a symmetry of the
lattice itself when `columns` is even.

At `rows = 7` the computed column count was 45. Odd. The two ends landed half a
cell apart.

## Count it

A throwaway script generated vertices at `(i, j, corner)`, welded them, and
counted bonds per node:

| | before | after |
|---|---|---|
| 7 rows | 14 nodes with degree 2 | all degree 3 |
| 6 rows | 12 nodes with degree 2 | all degree 3 |
| edges / nodes | 1.489 | 644 : 966 = 1.5 |

A closed honeycomb on a torus must satisfy `E = 1.5V`: six edges per hexagon,
each shared by two hexagons; three hexagons per vertex. Any ratio below 1.5 is
missing `1.5V - E` bonds. At seven rows that was 966 − 959 = 7, exactly half of
those fourteen degree-2 nodes.

## The fix

Three parts, and all three matter:

1. **Even column counts.** Rounded to the nearest even number in `quality.ts`
   (46 on desktop, 38 on mobile), and enforced again inside `buildLoopLattice`
   so no caller can produce a seam.
2. **Half-cell integer coordinates.** `3i` along the loop, `2j + (i % 2)` around
   the tube, the six corners from a table. The weld key is then a pure integer,
   out of reach of floating point.
3. **The invariant as a check.** The scene writes `nodes:edges` to
   `#scene-host[data-lattice]` and `scripts/check.mjs` asserts the ratio is 1.5.

Part two deserves a sentence. The weld key used to be a `toFixed(3)` string.
One ulp of difference at the seam could put a vertex at `0` or at
`spanAround - ε`, so the same corner became two vertices, and once in a while a
lone sphere appeared. Integer coordinates turn that class of bug from
occasional into impossible.

## Why keep the note

The signature here is that **it looks like rendering and is actually topology**.
The eye reports "overlap"; the cause is "one missing bond". Next time a pair of
spheres or a dangling strut shows up, count degrees before touching a shader.
