// Block palette for the voxel world. Colours are sRGB 0..1; the mesher adds per-voxel jitter.

export enum Block {
  Air = 0,
  Grass,
  Dirt,
  Sand,
  Stone,
  Wood,
  Leaves,
  LeavesDark,
  Plank,
  TempleStone,
  MossStone,
  Hull,
  Rock,
  Cloth,
  Crate,
  Flower,
}

export interface BlockInfo {
  color: [number, number, number];
  /** How much each voxel's colour may vary, for a hand-made look. */
  jitter: number;
  climbable: boolean;
}

const info: BlockInfo[] = [];
const def = (b: Block, color: [number, number, number], jitter: number, climbable = false) =>
  (info[b] = { color, jitter, climbable });

def(Block.Air, [0, 0, 0], 0);
def(Block.Grass, [0.33, 0.55, 0.22], 0.09);
def(Block.Dirt, [0.48, 0.33, 0.2], 0.06);
def(Block.Sand, [0.9, 0.82, 0.58], 0.05);
def(Block.Stone, [0.5, 0.5, 0.5], 0.06);
def(Block.Wood, [0.45, 0.3, 0.17], 0.06, true);
def(Block.Leaves, [0.24, 0.58, 0.2], 0.1);
def(Block.LeavesDark, [0.16, 0.45, 0.18], 0.1);
def(Block.Plank, [0.62, 0.45, 0.27], 0.05);
def(Block.TempleStone, [0.66, 0.63, 0.55], 0.06, true);
def(Block.MossStone, [0.46, 0.55, 0.38], 0.08, true);
def(Block.Hull, [0.55, 0.3, 0.18], 0.04);
def(Block.Rock, [0.55, 0.54, 0.52], 0.07);
def(Block.Cloth, [0.85, 0.78, 0.6], 0.03);
def(Block.Crate, [0.7, 0.52, 0.3], 0.05);
def(Block.Flower, [0.98, 0.86, 0.38], 0.2);

export function blockInfo(b: number): BlockInfo {
  return info[b] ?? info[Block.Stone];
}

export function isClimbable(b: number): boolean {
  return b !== Block.Air && blockInfo(b).climbable;
}
