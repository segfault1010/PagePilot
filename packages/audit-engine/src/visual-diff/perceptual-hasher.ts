import {
  GRID_COLUMNS,
  GRID_ROWS,
  TOTAL_GRID_BLOCKS,
} from "@pagepilot/contracts";

/**
 * Computes perceptual luminance Y from sRGB channels:
 * Y = 0.299 * R + 0.587 * G + 0.114 * B (Rec. 601)
 */
export function rgbToLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Computes difference hash (dHash) from an H x W luminance matrix.
 * Compares adjacent horizontal values: matrix[y][x+1] > matrix[y][x].
 * Returns a hex string.
 */
export function computeDHashFromMatrix(matrix: number[][]): string {
  const height = matrix.length;
  if (height === 0) return "";
  const width = matrix[0]?.length ?? 0;
  if (width < 2) return "";

  let hex = "";
  let currentNibble = 0;
  let bitCount = 0;

  for (let y = 0; y < height; y++) {
    const row = matrix[y]!;
    for (let x = 0; x < width - 1; x++) {
      const bit = row[x + 1]! > row[x]! ? 1 : 0;
      currentNibble = (currentNibble << 1) | bit;
      bitCount++;

      if (bitCount === 4) {
        hex += currentNibble.toString(16);
        currentNibble = 0;
        bitCount = 0;
      }
    }
  }

  if (bitCount > 0) {
    currentNibble <<= 4 - bitCount;
    hex += currentNibble.toString(16);
  }

  return hex;
}

/**
 * Computes global 256-bit dHash (64 hex characters) and 32 block hashes
 * (16 hex characters = 64 bits each) from a normalized luminance grid.
 */
export function computeHashesFromLuminanceGrid(
  grid: number[][],
  gridWidth: number,
  gridHeight: number
): { perceptualHash: string; blockHashes: string[] } {
  // 1. Global 256-bit dHash: downsample grid to 17x16 (16x16 differences = 256 bits = 64 hex chars)
  const globalTargetW = 17;
  const globalTargetH = 16;
  const globalMatrix: number[][] = [];

  for (let gy = 0; gy < globalTargetH; gy++) {
    const row: number[] = [];
    const srcY = Math.floor((gy / globalTargetH) * gridHeight);
    for (let gx = 0; gx < globalTargetW; gx++) {
      const srcX = Math.floor((gx / globalTargetW) * gridWidth);
      row.push(grid[srcY]?.[srcX] ?? 0);
    }
    globalMatrix.push(row);
  }

  const perceptualHash = computeDHashFromMatrix(globalMatrix);

  // 2. 32-Block Hashes: partition the grid into 4 columns x 8 rows
  const blockHashes: string[] = [];
  const blockW = Math.floor(gridWidth / GRID_COLUMNS);
  const blockH = Math.floor(gridHeight / GRID_ROWS);

  for (let blockIdx = 0; blockIdx < TOTAL_GRID_BLOCKS; blockIdx++) {
    const blockRow = Math.floor(blockIdx / GRID_COLUMNS);
    const blockCol = blockIdx % GRID_COLUMNS;

    const startX = blockCol * blockW;
    const startY = blockRow * blockH;

    // Downsample each block to 9x8 matrix (8x8 differences = 64 bits = 16 hex chars)
    const blockMatrix: number[][] = [];
    const targetBlockW = 9;
    const targetBlockH = 8;

    for (let ty = 0; ty < targetBlockH; ty++) {
      const bRow: number[] = [];
      const srcY = startY + Math.floor((ty / targetBlockH) * blockH);
      for (let tx = 0; tx < targetBlockW; tx++) {
        const srcX = startX + Math.floor((tx / targetBlockW) * blockW);
        bRow.push(grid[srcY]?.[srcX] ?? 0);
      }
      blockMatrix.push(bRow);
    }

    const bHash = computeDHashFromMatrix(blockMatrix);
    // Ensure fixed 16 hex chars (64 bits)
    blockHashes.push(bHash.padStart(16, "0").slice(0, 16));
  }

  return {
    perceptualHash: perceptualHash.padStart(64, "0").slice(0, 64),
    blockHashes,
  };
}

/**
 * Deterministically generates synthetic 32-block hashes for testing
 */
export function generateSyntheticBlockHashes(options?: {
  seed?: string;
  heroVariation?: number; // 0 to 1
  bodyVariation?: number;
  footerVariation?: number;
}): { perceptualHash: string; blockHashes: string[] } {
  const seed = options?.seed ?? "default";
  const heroVar = options?.heroVariation ?? 0;
  const bodyVar = options?.bodyVariation ?? 0;
  const footerVar = options?.footerVariation ?? 0;

  const blockHashes: string[] = [];

  for (let i = 0; i < TOTAL_GRID_BLOCKS; i++) {
    const row = Math.floor(i / GRID_COLUMNS);
    let variation = 0;
    if (row < 3) variation = heroVar;
    else if (row < 6) variation = bodyVar;
    else variation = footerVar;

    // Base hash deterministically derived from seed and index
    let baseVal = 0;
    for (let charIdx = 0; charIdx < seed.length; charIdx++) {
      baseVal = (baseVal * 31 + seed.charCodeAt(charIdx)) >>> 0;
    }
    baseVal = (baseVal + i * 1337) >>> 0;

    // Flip bits proportionally to variation
    let hex = "";
    for (let h = 0; h < 16; h++) {
      let nibble = (baseVal >> ((h % 8) * 4)) & 0xf;
      if (variation > 0) {
        const shouldFlip = ((baseVal + h * 7) % 100) / 100 < variation;
        if (shouldFlip) {
          nibble ^= 0xf;
        }
      }
      hex += nibble.toString(16);
    }
    blockHashes.push(hex);
  }

  // Generate 64-char perceptual hash
  let globalHex = "";
  for (let i = 0; i < 4; i++) {
    globalHex += blockHashes[i] ?? "0000000000000000";
  }

  return {
    perceptualHash: globalHex.padEnd(64, "0").slice(0, 64),
    blockHashes,
  };
}
