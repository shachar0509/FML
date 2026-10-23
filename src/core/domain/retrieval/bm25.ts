const PREFIX = "והבלשכמ";

/** Spec 9.9 step 2: letters only, lowercase, no niqqud; plus the variant without a one-letter Hebrew prefix. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const t of text.replace(/[֑-ׇ]/g, "").toLowerCase().split(/[^\p{L}]+/u)) {
    if (!t) continue;
    out.push(t);
    if (t.length > 3 && PREFIX.includes(t[0] as string)) out.push(t.slice(1));
  }
  return out;
}

/** R3: a doc's tokens by id, reused only while its text is the exact same string (re-scans change summaries and teacher transcriptions under the same sha). Process memory only. */
export const tokenCache = new Map<string, { text: string; toks: readonly string[] }>();
// ponytail: LRU by entry count, not bytes; a candidate set larger than this misses every time (same results, today's speed)
export const TOKEN_CACHE_MAX = 5000;

function tokensOf(id: string, text: string): readonly string[] {
  const hit = tokenCache.get(id);
  const toks = hit && hit.text === text ? hit.toks : tokenize(text);
  tokenCache.delete(id);
  tokenCache.set(id, { text, toks });
  if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value as string);
  return toks;
}

const K1 = 1.2;
const B = 0.75;

export function rank(docs: { id: string; text: string }[], query: string): { id: string; score: number }[] {
  const toks = docs.map((d) => tokensOf(d.id, d.text));
  const avg = toks.reduce((a, t) => a + t.length, 0) / (docs.length || 1) || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  return docs
    .map((d, i) => {
      const t = toks[i] as readonly string[];
      const tf = new Map<string, number>();
      for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const n = df.get(w) as number;
        score += Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * t.length) / avg)));
      }
      return { id: d.id, score };
    })
    .sort((a, b) => b.score - a.score);
}
