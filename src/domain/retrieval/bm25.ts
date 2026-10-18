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

const K1 = 1.2;
const B = 0.75;

export function rank(docs: { id: string; text: string }[], query: string): { id: string; score: number }[] {
  const toks = docs.map((d) => tokenize(d.text));
  const avg = toks.reduce((a, t) => a + t.length, 0) / (docs.length || 1) || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  return docs
    .map((d, i) => {
      const t = toks[i] as string[];
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
