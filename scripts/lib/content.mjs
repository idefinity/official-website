/**
 * The bits the two collections genuinely share.
 *
 * Research topics and products have different schemas, different validators and
 * different pages. What they do share is how they are read from disk, searched
 * and printed — so that much lives here, and everything that decides meaning
 * stays in `research.mjs` / `product.mjs`.
 *
 * Nothing in this file knows what a topic or a product is.
 */

/* ---------- terminal ---------- */

export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s) => `\x1b[1m${s}\x1b[0m`;
export const gold = (s) => `\x1b[33m${s}\x1b[0m`;
export const red = (s) => `\x1b[31m${s}\x1b[0m`;
export const green = (s) => `\x1b[32m${s}\x1b[0m`;

/* ---------- arguments ---------- */

const BOOLEAN_FLAGS = new Set(["force", "help"]);

/**
 * `--track=x` and `--track x` both work; a boolean flag never eats the word
 * after it, which is the one thing a hand-written parser usually gets wrong.
 */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    if (body.includes("=")) {
      const [key, value] = body.split("=");
      flags[key] = value;
    } else if (BOOLEAN_FLAGS.has(body) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
      flags[body] = true;
    } else {
      flags[body] = argv[++i];
    }
  }
  return { positional, flags };
}

/* ---------- shape ---------- */

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && !Number.isNaN(Date.parse(value));

/** A localized field is `{ zh, en? }`; English falls back to Chinese on purpose. */
export const text = (localized, language = "zh") =>
  localized?.[language] ?? localized?.zh ?? "";

const CJK = /[\u3400-\u9fff]/g;
const LATIN = /[A-Za-z][A-Za-z'-]*/g;

export function countWords(source) {
  return (source.match(CJK) ?? []).length + (source.match(LATIN) ?? []).length;
}

/* ---------- search ---------- */

/**
 * Chinese has no spaces, so the unit is a pair of characters: 「晶格接缝」 becomes
 * 晶格 / 格接 / 接缝. No dictionary, so a word nobody has seen before still
 * matches. Latin words are matched whole, minus the usual filler.
 */
const STOP = new Set(
  "the and for with that this from into over under than then when what which were was are its our you your they their will can not but all any one two".split(
    " ",
  ),
);

function grams(source) {
  const out = new Set();
  const clean = String(source).toLowerCase().replace(/[\s]+/g, " ");
  for (const run of clean.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  for (const word of clean.match(/[a-z][a-z0-9+#.-]+/g) ?? []) {
    if (word.length < 2 || STOP.has(word)) continue;
    out.add(word);
  }
  return out;
}

/**
 * Coverage first, then how much weight the hit carried: a rare word in a title
 * should outrank the same word buried in a long body. A gram counts once per
 * record however often it appears, so a windy note cannot win by repetition.
 */
export function rank(fields, weights, query) {
  const wanted = grams(query);
  if (!wanted.size) return { hits: 0, coverage: 0, score: 0 };
  let total = 0;
  let hits = 0;
  for (const gram of wanted) {
    let best = 0;
    for (const [field, source] of Object.entries(fields)) {
      if ((source ?? "").toLowerCase().includes(gram)) {
        best = Math.max(best, weights[field] ?? 1);
      }
    }
    if (best) {
      hits += 1;
      total += best;
    }
  }
  const coverage = hits / wanted.size;
  return { hits, coverage, score: coverage * 100 + (total / wanted.size) * 10 };
}
