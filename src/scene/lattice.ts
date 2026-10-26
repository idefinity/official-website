/**
 * A hexagonal tiling wrapped around the loop. Corners shared by neighbouring
 * cells are welded before anything is measured, so the mesh really is a lattice
 * of hexagons and not a pile of overlapping rings.
 *
 * Everything here is counted in half cells: 3 units along the loop and 2 units
 * around the tube per cell. In those units every corner lands on an integer, so
 * welding two cells into one node is an exact integer match rather than a
 * `toFixed` guess that can drift one ulp either side of the seam and quietly
 * leave a duplicate node behind.
 *
 * The tiling only closes on itself when the along period holds whole pairs of
 * columns. An odd count rewraps the brick offset by half a cell: the last two
 * columns no longer share corners with the first two, and the seam shows up as
 * a ring of atoms with two bonds instead of three. `columns` is rounded down to
 * an even number for that reason — the callers ask for a density, not a defect.
 */
export interface LoopNode {
  s: number;
  theta: number;
}

export interface LoopEdge {
  a: number;
  b: number;
}

export interface LoopLattice {
  nodes: LoopNode[];
  edges: LoopEdge[];
}

/** Cell step along the loop, in half cells. */
const ALONG_STEP = 3;
/** Cell step around the tube, in half cells. */
const AROUND_STEP = 2;
/** Corner offsets for a regular hexagon, doubled so they stay integers. */
const CORNER_ALONG = [2, 1, -1, -2, -1, 1];
/** Corner offsets in units of (√3 / 2), so these are integers too. */
const CORNER_AROUND = [0, 1, 1, 0, -1, -1];

const wrap = (value: number, span: number) => ((value % span) + span) % span;

export function buildLoopLattice(columns: number, rows: number): LoopLattice {
  const cols = Math.max(2, columns - (columns % 2));
  const spanAlong = ALONG_STEP * cols;
  const spanAround = AROUND_STEP * rows;
  const nodes: LoopNode[] = [];
  const edges: LoopEdge[] = [];
  const welded = new Map<string, number>();
  const bonds = new Set<string>();

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const centreAlong = ALONG_STEP * i;
      // Every other column sits half a cell further around: the brick offset
      // that turns a stack of hexagons into a honeycomb.
      const centreAround = AROUND_STEP * j + (i % 2);
      const corners: number[] = [];
      for (let k = 0; k < 6; k++) {
        const along = wrap(centreAlong + CORNER_ALONG[k], spanAlong);
        const around = wrap(centreAround + CORNER_AROUND[k], spanAround);
        const key = `${along}:${around}`;
        let id = welded.get(key);
        if (id === undefined) {
          id = nodes.length;
          welded.set(key, id);
          nodes.push({ s: along / spanAlong, theta: around / spanAround });
        }
        corners.push(id);
      }
      for (let k = 0; k < 6; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!bonds.has(key)) {
          bonds.add(key);
          edges.push({ a, b });
        }
      }
    }
  }
  return { nodes, edges };
}
