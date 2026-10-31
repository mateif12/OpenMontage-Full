// Deterministic RNG so every frame (and every re-render) is identical.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.weighted = (arr, key = 'weight') => {
    const total = arr.reduce((s, x) => s + (x[key] ?? 1), 0);
    let r = next() * total;
    for (const x of arr) { r -= x[key] ?? 1; if (r <= 0) return x; }
    return arr[arr.length - 1];
  };
  return next;
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
