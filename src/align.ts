// Character alignment between a block's Markdown source and its rendered text, so Reading mode
// can find a mark's content inside the DOM and map a DOM selection back to source offsets.
// Myers diff (O((N+M)·D)) with a cap on D; a greedy subsequence matcher is the fallback.

/**
 * Returns `map` of length src.length + 1: map[i] is the rendered offset of source char i when it
 * survived rendering, or the rendered offset where the next surviving char lands when it did not.
 * map[src.length] === out.length. The array is non-decreasing.
 */
export function alignText(src: string, out: string): Int32Array {
  // Padded tables carry thousands of spaces and dashes that never render, which would push the
  // diff past its cap. Keep only the first and last char of each long run, align that, then expand.
  const kept: number[] = [];
  let reduced = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if ((c === " " || c === "\t" || c === "-") && i > 0 && src[i - 1] === c && i + 1 < src.length && src[i + 1] === c) continue;
    kept.push(i);
    reduced += c;
  }
  if (kept.length === src.length) return alignCore(src, out);
  const rmap = alignCore(reduced, out);
  const map = new Int32Array(src.length + 1);
  let k = kept.length;
  map[src.length] = rmap[k];
  // A dropped char takes the rendered offset of the next kept char, as an unrendered char would.
  for (let i = src.length - 1; i >= 0; i--) {
    if (k > 0 && kept[k - 1] === i) k--;
    map[i] = rmap[k];
  }
  return map;
}

function alignCore(src: string, out: string): Int32Array {
  const N = src.length;
  const M = out.length;
  const map = new Int32Array(N + 1);
  if (N === 0) return map;
  if (src === out) {
    for (let i = 0; i <= N; i++) map[i] = i;
    return map;
  }
  const MAX = Math.min(1500, N + M);
  const offset = MAX + 1;
  const width = 2 * MAX + 3;
  let v = new Int32Array(width);
  v[offset + 1] = 0;
  const snapshots: Int32Array[] = [];
  for (let d = 0; d <= MAX; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && src.charCodeAt(x) === out.charCodeAt(y)) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        snapshots.push(v);
        return backtrack(snapshots, d, N, M, offset, map);
      }
    }
    snapshots.push(Int32Array.from(v));
    v = Int32Array.from(v);
  }
  return greedy(src, out, map);
}

function backtrack(snapshots: Int32Array[], D: number, N: number, M: number, offset: number, map: Int32Array): Int32Array {
  let x = N;
  let y = M;
  for (let d = D; d > 0; d--) {
    const v = snapshots[d - 1];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    let midX: number;
    let midY: number;
    if (prevK === k + 1) {
      // insertion in rendered text: no source char
      midX = prevX;
      midY = prevY + 1;
    } else {
      // deletion of source char prevX
      midX = prevX + 1;
      midY = prevY;
      map[prevX] = prevY;
    }
    // snake from (midX, midY) to (x, y)
    for (let i = midX, j = midY; i < x; i++, j++) map[i] = j;
    x = prevX;
    y = prevY;
  }
  // d = 0 snake from (0,0)
  for (let i = 0; i < x; i++) map[i] = i;
  map[N] = M;
  return map;
}

function greedy(src: string, out: string, map: Int32Array): Int32Array {
  const N = src.length;
  const M = out.length;
  let i = 0;
  let j = 0;
  while (i < N) {
    if (j < M && src.charCodeAt(i) === out.charCodeAt(j)) {
      map[i++] = j++;
      continue;
    }
    if (j >= M) {
      map[i++] = M;
      continue;
    }
    const srcAhead = out.indexOf(src[i], j);
    const outAhead = src.indexOf(out[j], i);
    if ((srcAhead === -1 || srcAhead - j > 128) && outAhead !== -1 && outAhead - i <= 128) {
      j++; // rendered char with no source: skip it
      continue;
    }
    map[i++] = j; // source char that did not render
  }
  map[N] = M;
  return map;
}

/** Source offset whose char renders at `r` (prefers a surviving char), for selection starts. */
export function sourceStart(map: Int32Array, r: number): number {
  let lo = 0;
  let hi = map.length - 1;
  // largest i with map[i] <= r
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid] <= r) lo = mid;
    else hi = mid - 1;
  }
  // step back over trailing entries that equal r but belong to deleted chars after a surviving one? Those have map = r+1, so lo is right.
  return lo;
}

/** Source offset just after the char rendered at `r - 1`, for selection ends. */
export function sourceEnd(map: Int32Array, r: number): number {
  if (r <= 0) return 0;
  return Math.min(map.length - 1, sourceStart(map, r - 1) + 1);
}
