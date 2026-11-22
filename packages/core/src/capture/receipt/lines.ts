import type { OcrBlock } from '../../ports/OcrEngine';

export interface Line {
  /** Fragments left to right, joined with a space. */
  readonly text: string;
  readonly blocks: readonly OcrBlock[];
  /** Highest edge in the original image (for the top-fifth rule). */
  readonly top: number;
  /** The lowest engine confidence among the fragments, or null when none reported one. */
  readonly confidence: number | null;
}

interface P {
  readonly b: OcrBlock;
  readonly x: number;
  readonly y: number;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
};

/**
 * Page skew in degrees (-6 to 6): the angle at which the block centres fall into the tightest rows (a smooth count of pairs that share a
 * row, so a row that straddles a bin edge is not split). It leaves 0 unless another angle is clearly better.
 */
function skewDegrees(points: readonly P[], width: number, height: number, bin: number): number {
  if (points.length < 6 || bin <= 0) return 0;
  const sigma = bin / 2;
  const scoreAt = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const ys = points.map((p) => (p.y - height / 2) * cos - (p.x - width / 2) * sin).sort((a, b) => a - b);
    let score = 0;
    for (let i = 0; i < ys.length; i++) {
      for (let j = i + 1; j < ys.length; j++) {
        const d = (ys[j]! - ys[i]!) / sigma;
        if (d > 4) break;
        score += Math.exp(-d * d);
      }
    }
    return score;
  };
  const flat = scoreAt(0);
  let best = 0;
  let bestScore = flat * 1.05 + points.length * 0.15;
  for (let step = -12; step <= 12; step++) {
    if (step === 0) continue;
    const sc = scoreAt(step * 0.5);
    if (sc > bestScore) {
      best = step * 0.5;
      bestScore = sc;
    }
  }
  return best;
}

/**
 * Joins the engine's text fragments into printed lines. A fragment joins a line when its vertical midpoint, `(top + bottom) / 2`, is within
 * half the median fragment height of the line's midpoint, so the tolerance follows the type size. A photo taken at a slope (up to about 5
 * degrees) is first rotated back by the angle that makes the rows sharpest, so a price on the far right still lands on its item's row.
 */
export function groupLines(blocks: readonly OcrBlock[], width: number, height: number): Line[] {
  const usable = blocks.filter((b) => b.text.trim() !== '' && b.box.bottom > b.box.top && b.box.right > b.box.left);
  if (usable.length === 0) return [];
  const medH = median(usable.map((b) => b.box.bottom - b.box.top));
  const pts: P[] = usable.map((b) => ({ b, x: (b.box.left + b.box.right) / 2, y: (b.box.top + b.box.bottom) / 2 }));
  const deg = skewDegrees(pts, width, height, medH / 2);
  const rad = (deg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const rot = pts
    .map((p) => ({
      p,
      mid: (p.y - height / 2) * cos - (p.x - width / 2) * sin,
      left: (p.b.box.left - width / 2) * cos + (p.y - height / 2) * sin,
    }))
    .sort((a, c) => a.mid - c.mid || a.left - c.left);
  const groups: { mids: number[]; members: typeof rot }[] = [];
  for (const r of rot) {
    const g = groups[groups.length - 1];
    const mean = g ? g.mids.reduce((s, v) => s + v, 0) / g.mids.length : 0;
    if (g && Math.abs(r.mid - mean) <= medH / 2) {
      g.mids.push(r.mid);
      g.members.push(r);
    } else groups.push({ mids: [r.mid], members: [r] });
  }
  return groups.map((g) => {
    const members = [...g.members].sort((a, c) => a.left - c.left);
    const bs = members.map((m) => m.p.b);
    const confs = bs.map((b) => b.confidence).filter((c): c is number => c !== null);
    return {
      text: bs.map((b) => b.text.trim()).join(' '),
      blocks: bs,
      top: Math.min(...bs.map((b) => b.box.top)),
      confidence: confs.length === 0 ? null : Math.min(...confs),
    };
  });
}
