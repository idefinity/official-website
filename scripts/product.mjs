#!/usr/bin/env node
/**
 * The product catalogue, from the terminal.
 *
 * A product is a directory: `product.json`, `notes.zh.md`, `notes.en.md`.
 * Same shape as a research topic, on purpose — one set of habits for both
 * collections, and an import/export bundle that looks like the other one.
 *
 *   npm run product -- list --category=database
 *   npm run product -- show graphfin
 *   npm run product -- index
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bold,
  countWords,
  dim,
  gold,
  green,
  isDate,
  parseArgs,
  rank,
  red,
  SLUG as slug,
  text,
} from "./lib/content.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ITEMS = join(ROOT, "product", "items");
const INDEX = join(ROOT, "product", "index.json");
const PUBLIC = join(ROOT, "public", "product");
const CATALOG_FILE = join(ROOT, "product", "catalog.json");
const RESEARCH_INDEX = join(ROOT, "research", "index.json");

const SCHEMA = "idefinity.product/1";
const BUNDLE = "idefinity.product.bundle/1";
const LINK_KINDS = ["repo", "docs", "download", "demo"];

/**
 * Only a safety net. `product/catalog.json` is the source: adding a category
 * should not mean editing the validator, the index, the menu and the page.
 */
const FALLBACK_CATALOG = {
  schema: "idefinity.product.catalog/1",
  categories: [
    { id: "database", zh: "数据库", en: "Database" },
    { id: "interface", zh: "界面", en: "Interface" },
    { id: "tooling", zh: "工具", en: "Tooling" },
    { id: "service", zh: "服务", en: "Service" },
  ],
  stages: [
    { id: "concept", zh: "构想", en: "Concept" },
    { id: "alpha", zh: "内测", en: "Alpha" },
    { id: "beta", zh: "公测", en: "Beta" },
    { id: "stable", zh: "稳定", en: "Stable" },
    { id: "retired", zh: "停止维护", en: "Retired" },
  ],
};

async function readCatalog() {
  try {
    const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
    const list = (key, fallback) => {
      const value = raw[key];
      if (!Array.isArray(value) || !value.length) return fallback;
      return value
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => ({ ...entry, zh: entry.zh ?? entry.id, en: entry.en ?? entry.id }));
    };
    return {
      schema: raw.schema ?? FALLBACK_CATALOG.schema,
      categories: list("categories", FALLBACK_CATALOG.categories),
      stages: list("stages", FALLBACK_CATALOG.stages),
    };
  } catch {
    return FALLBACK_CATALOG;
  }
}

const CATALOG = await readCatalog();
const CATEGORIES = CATALOG.categories.map((entry) => entry.id);
const STAGES = CATALOG.stages.map((entry) => entry.id);

/* ---------- reading ---------- */

async function readProduct(id) {
  const dir = join(ITEMS, id);
  const meta = JSON.parse(await readFile(join(dir, "product.json"), "utf8"));
  const read = async (file) =>
    existsSync(join(dir, file)) ? readFile(join(dir, file), "utf8") : "";
  return {
    meta,
    notes: { zh: await read("notes.zh.md"), en: await read("notes.en.md") },
  };
}

async function loadAll() {
  if (!existsSync(ITEMS)) return [];
  const names = (await readdir(ITEMS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const products = [];
  for (const name of names) {
    try {
      const product = await readProduct(name);
      if (product.meta.id !== name) {
        product.problems = [`folder is "${name}" but id is "${product.meta.id}"`];
      }
      products.push(product);
    } catch (error) {
      products.push({
        meta: { id: name, name, tagline: { zh: name }, category: "tooling", stage: "concept", highlights: [], updated: "1970-01-01" },
        notes: { zh: "", en: "" },
        problems: [String(error.message)],
      });
    }
  }
  return products;
}

/** Ids a product may point at, from the generated research index. */
async function researchIds() {
  try {
    const index = JSON.parse(await readFile(RESEARCH_INDEX, "utf8"));
    return new Set((index.topics ?? []).map((topic) => topic.id));
  } catch {
    return null;
  }
}

/* ---------- validating ---------- */

function validate(product, knownTopics = null) {
  const errors = [...(product.problems ?? [])];
  const m = product.meta;
  if (m.schema && m.schema !== SCHEMA) errors.push(`schema must be "${SCHEMA}"`);
  if (!slug.test(m.id ?? "")) errors.push("id must be a lowercase slug (a-z, 0-9, single dashes)");
  if ((m.id ?? "").length > 48) errors.push("id is longer than 48 characters");
  if (!m.name?.trim()) errors.push("name is required");
  else if (m.name.length > 40) errors.push("name is longer than 40 characters");
  if (!m.tagline?.zh) errors.push("tagline.zh is required — one line for someone who reads one line");
  if (!m.summary?.zh) errors.push("summary.zh is required");
  if (!CATEGORIES.includes(m.category)) errors.push(`category must be one of ${CATEGORIES.join(", ")}`);
  if (!STAGES.includes(m.stage)) errors.push(`stage must be one of ${STAGES.join(", ")}`);
  if (m.version !== undefined && !/^\d+\.\d+(\.\d+)?(-[a-z0-9.]+)?$/.test(m.version)) {
    errors.push('version looks like "0.1.0" or "0.1.0-alpha", without a leading v');
  }

  const highlights = m.highlights;
  if (!Array.isArray(highlights) || !highlights.length) {
    errors.push("highlights needs at least one entry — it is what the deck shows");
  } else if (highlights.length > 6) {
    errors.push("highlights caps at 6");
  } else {
    for (const [index, item] of highlights.entries()) {
      if (!item?.title?.zh) errors.push(`highlights[${index}].title.zh is required`);
      if (!item?.text?.zh) errors.push(`highlights[${index}].text.zh is required`);
      else if (item.text.zh.length < 6) errors.push(`highlights[${index}].text is a stub: "${item.text.zh}"`);
      else if (item.text.zh.length > 240) errors.push(`highlights[${index}].text is longer than 240 characters`);
    }
  }

  const facts = m.facts ?? [];
  if (!Array.isArray(facts)) errors.push("facts is a list of { label, value }");
  else if (facts.length > 6) errors.push("facts caps at 6");
  else {
    const seen = new Set();
    for (const fact of facts) {
      if (!fact?.label?.zh || !fact?.value?.zh) errors.push("every fact needs label.zh and value.zh");
      const key = fact?.label?.zh ?? "";
      if (seen.has(key)) errors.push(`duplicate fact label "${key}"`);
      seen.add(key);
    }
  }

  const links = m.links ?? [];
  if (!Array.isArray(links)) errors.push("links is a list");
  else if (links.length > 6) errors.push("links caps at 6");
  else {
    for (const link of links) {
      if (!LINK_KINDS.includes(link?.kind)) {
        errors.push(`link kind must be one of ${LINK_KINDS.join(", ")}`);
      }
      if (!link?.label?.zh) errors.push("every link needs label.zh");
      if (!/^(https?:\/\/|mailto:|\/)/.test(link?.href ?? "")) {
        errors.push(`link href must be absolute or site-relative: ${link?.href}`);
      }
    }
  }

  if (m.research !== undefined) {
    if (!Array.isArray(m.research)) errors.push("research is a list of topic ids");
    else if (!knownTopics) {
      // No index yet: silently skip. `npm run build` regenerates research first.
    } else {
      for (const id of m.research) {
        if (!knownTopics.has(id)) {
          errors.push(`unknown research topic "${id}" — run research index, or fix the id`);
        }
      }
    }
  }

  if (m.order !== undefined && (!Number.isInteger(m.order) || m.order < 0)) {
    errors.push("order must be a whole number, 0 or more");
  }
  if (!isDate(m.updated ?? "")) errors.push("updated must be YYYY-MM-DD");
  if (m.created && !isDate(m.created)) errors.push("created must be YYYY-MM-DD");
  if (!product.notes.zh.trim()) errors.push("notes.zh.md is empty");
  if (!product.notes.en.trim()) errors.push("notes.en.md is empty (the site is bilingual)");
  return errors;
}

/* ---------- searching ---------- */

const WEIGHTS = { id: 2, name: 4, tagline: 3, summary: 2.5, highlights: 2, facts: 1.5, body: 1 };

function score(product, query) {
  const m = product.meta;
  return rank(
    {
      id: m.id.replace(/-/g, " "),
      name: m.name ?? "",
      tagline: `${m.tagline?.zh ?? ""} ${m.tagline?.en ?? ""}`,
      summary: `${m.summary?.zh ?? ""} ${m.summary?.en ?? ""}`,
      highlights: (m.highlights ?? [])
        .flatMap((item) => [item.title?.zh, item.title?.en, item.text?.zh, item.text?.en])
        .filter(Boolean)
        .join(" "),
      facts: (m.facts ?? []).flatMap((fact) => [fact.label?.zh, fact.value?.zh]).filter(Boolean).join(" "),
      body: `${product.notes.zh} ${product.notes.en}`,
    },
    WEIGHTS,
    query,
  );
}

/* ---------- writing ---------- */

/**
 * The deck's order: `order` first, then name. Retired products sink to the
 * bottom without disappearing — an old product is still a real link, it just
 * should not be the thing the homepage opens with.
 */
function sorted(products) {
  return [...products].sort((a, b) => {
    const retired = Number(a.meta.stage === "retired") - Number(b.meta.stage === "retired");
    if (retired) return retired;
    const order = (a.meta.order ?? 1000) - (b.meta.order ?? 1000);
    if (order) return order;
    return String(a.meta.name).localeCompare(String(b.meta.name));
  });
}

function indexEntry(product) {
  const { meta, notes } = product;
  const words = { zh: countWords(notes.zh), en: countWords(notes.en) };
  return {
    id: meta.id,
    name: meta.name,
    tagline: meta.tagline,
    summary: meta.summary ?? { zh: "" },
    category: meta.category,
    stage: meta.stage,
    version: meta.version ?? "",
    notice: meta.notice,
    highlights: meta.highlights ?? [],
    facts: meta.facts ?? [],
    links: meta.links ?? [],
    research: meta.research ?? [],
    order: meta.order ?? null,
    updated: meta.updated,
    created: meta.created ?? meta.updated,
    words,
    // 400 hanzi a minute, 220 English words. Rounded up, minimum one.
    minutes: Math.max(1, Math.round((words.zh / 400 + words.en / 220) / 2)),
  };
}

async function writeIndex() {
  const products = await loadAll();
  const known = await researchIds();
  const bad = products.filter((product) => validate(product, known).length);
  if (bad.length) {
    console.error(red(`refusing to index ${bad.length} invalid product(s):`));
    for (const product of bad) {
      console.error(`  ${product.meta.id}: ${validate(product, known).join("; ")}`);
    }
    process.exitCode = 1;
    return;
  }
  const entries = sorted(products).map(indexEntry);
  const tally = (key) =>
    entries.reduce((acc, entry) => {
      acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
      return acc;
    }, {});
  const payload = {
    schema: "idefinity.product.index/1",
    generated: new Date().toISOString(),
    // The vocabulary rides along, so the page needs one request and a new
    // stage never has to be typed into the front end.
    catalog: CATALOG,
    counts: {
      products: entries.length,
      byCategory: tally("category"),
      byStage: tally("stage"),
    },
    products: entries,
  };

  await mkdir(join(ROOT, "product"), { recursive: true });
  await writeFile(INDEX, `${JSON.stringify(payload, null, 2)}\n`);

  // The site reads the same file plus one payload per product, so a detail page
  // costs a single small request and nothing else has to be parsed.
  await rm(PUBLIC, { recursive: true, force: true });
  await mkdir(join(PUBLIC, "items"), { recursive: true });
  await writeFile(join(PUBLIC, "index.json"), `${JSON.stringify(payload, null, 2)}\n`);
  for (const product of products) {
    const detail = { ...indexEntry(product), notes: product.notes };
    await writeFile(join(PUBLIC, "items", `${product.meta.id}.json`), `${JSON.stringify(detail, null, 2)}\n`);
  }
  console.log(
    `${green("indexed")} ${entries.length} product(s) ${dim("→ product/index.json, public/product/")}`,
  );
  return payload;
}

/* ---------- commands ---------- */

function printTable(entries) {
  const pad = (value, width) => String(value).padEnd(width);
  const idWidth = Math.max(12, ...entries.map((entry) => entry.id.length)) + 2;
  for (const entry of entries) {
    const stage =
      entry.stage === "stable" ? green : entry.stage === "retired" ? dim : gold;
    // Pad before colouring: an escape sequence counts as characters.
    const stageCell = stage(pad(entry.stage, 18));
    console.log(
      `${pad(entry.id, idWidth)}${dim(pad(entry.category, 12))}${stageCell}${dim(pad(entry.version || "—", 12))}${dim(entry.updated)}`,
    );
    console.log(`${" ".repeat(idWidth + 52)}${dim(text(entry.tagline))}`);
  }
}

async function main() {
  const [command = "list", ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  if (command === "list") {
    let entries = sorted(await loadAll()).map(indexEntry);
    if (flags.category) entries = entries.filter((entry) => entry.category === flags.category);
    if (flags.stage) entries = entries.filter((entry) => entry.stage === flags.stage);
    if (!entries.length) console.log(dim("nothing matches"));
    else printTable(entries);
    return;
  }

  if (command === "search") {
    const query = positional.join(" ");
    if (!query) throw new Error('search needs a query, e.g. npm run product -- search "图"');
    const products = await loadAll();
    const ranked = products
      .map((product) => ({ product, ...score(product, query) }))
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (!ranked.length) {
      console.log(dim(`nothing matches "${query}"`));
      return;
    }
    for (const row of ranked) {
      const percent = Math.round(row.coverage * 100);
      const bar = "█".repeat(Math.max(0, Math.round(percent / 10))).padEnd(10, "·");
      console.log(`${gold(bar)} ${String(percent).padStart(3)}%  ${bold(row.product.meta.name)}`);
      console.log(`        ${text(row.product.meta.tagline)}`);
    }
    return;
  }

  if (command === "show") {
    const id = positional[0];
    if (!id) throw new Error("show needs a product id");
    const product = await readProduct(id);
    const known = await researchIds();
    const problems = validate(product, known);
    const m = product.meta;
    console.log(`${bold(m.name)}  ${dim(m.id)}`);
    console.log(dim(`${m.category} / ${m.stage}${m.version ? ` / ${m.version}` : ""} · updated ${m.updated}`));
    console.log(`\n${text(m.tagline)}`);
    if (m.summary?.zh) console.log(dim(text(m.summary)));
    if (m.notice?.zh) console.log(`\n${gold("notice")} ${text(m.notice)}`);
    for (const item of m.highlights ?? []) console.log(`\n  · ${text(item.title)}\n    ${text(item.text)}`);
    if (m.facts?.length) {
      console.log("");
      for (const fact of m.facts) console.log(dim(`  ${text(fact.label)}: ${text(fact.value)}`));
    }
    if (m.links?.length) {
      console.log("");
      for (const link of m.links) console.log(dim(`  ${link.kind}: ${link.href}`));
    }
    console.log(`\n${product.notes.zh.trim()}`);
    if (problems.length) {
      console.log(red(`\n${problems.length} problem(s):`));
      for (const problem of problems) console.log(red(`  - ${problem}`));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "validate") {
    const products = await loadAll();
    const known = await researchIds();
    let failures = 0;
    for (const problem of await catalogDrift()) {
      failures += 1;
      console.log(red(`✗ ${problem}`));
    }
    for (const product of products) {
      const problems = validate(product, known);
      if (problems.length) {
        failures += 1;
        console.log(red(`✗ ${product.meta.id}`));
        for (const problem of problems) console.log(`    ${problem}`);
      } else {
        console.log(`${green("✓")} ${product.meta.id}`);
      }
    }
    const ids = new Set(products.map((product) => product.meta.id));
    if (ids.size !== products.length) {
      failures += 1;
      console.log(red("✗ duplicate ids"));
    }
    if (!known && products.some((product) => product.meta.research?.length)) {
      console.log(dim("· research/index.json is missing, so cross-links were not checked"));
    }
    if (failures) {
      process.exitCode = 1;
      console.log(red(`\n${failures} product(s) need fixing`));
    } else {
      console.log(green(`\nall ${products.length} product(s) valid`));
    }
    return;
  }

  if (command === "index") {
    await writeIndex();
    return;
  }

  if (command === "new") {
    const id = positional[0];
    if (!id || !slug.test(id)) throw new Error("new needs a slug id, e.g. graphfin");
    const dir = join(ITEMS, id);
    if (existsSync(dir)) throw new Error(`${id} already exists`);
    const category = flags.category ?? "database";
    if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
    const stage = flags.stage ?? "concept";
    if (!STAGES.includes(stage)) throw new Error(`stage must be one of ${STAGES.join(", ")}`);
    const today = new Date().toISOString().slice(0, 10);
    await mkdir(dir, { recursive: true });
    const meta = {
      schema: SCHEMA,
      id,
      name: id,
      tagline: { zh: "改这一行：一句话说清它是什么", en: "Replace this line: what it is, in one sentence" },
      summary: { zh: "两三句话：给谁用，解决什么，现在到哪一步。", en: "" },
      category,
      stage,
      notice: { zh: "能跑，能评估，还不建议直接上生产。", en: "" },
      highlights: [
        {
          title: { zh: "第一条能力", en: "First capability" },
          text: { zh: "它能做什么，一句话。别写形容词，写动作。", en: "" },
        },
      ],
      facts: [],
      links: [],
      research: [],
      order: 10,
      owner: "zziang",
      created: today,
      updated: today,
    };
    await writeFile(join(dir, "product.json"), `${JSON.stringify(meta, null, 2)}\n`);
    await writeFile(join(dir, "notes.zh.md"), `# ${meta.name}\n\n还没开始。先说清它不是什么。\n`);
    await writeFile(join(dir, "notes.en.md"), `# ${meta.name}\n\nNot started. Say what it is not, first.\n`);
    console.log(`${green("created")} product/items/${id}/`);
    return;
  }

  if (command === "export") {
    const ids = positional.length ? positional : (await loadAll()).map((product) => product.meta.id);
    const products = [];
    for (const id of ids) {
      const product = await readProduct(id);
      products.push({ meta: product.meta, notes: product.notes });
    }
    const bundle = {
      schema: BUNDLE,
      exported: new Date().toISOString(),
      products,
    };
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    if (flags.out) {
      await writeFile(resolve(flags.out), json);
      console.log(`${green("exported")} ${products.length} product(s) → ${flags.out} ${dim(`${(json.length / 1024).toFixed(1)} kB`)}`);
    } else {
      process.stdout.write(json);
    }
    return;
  }

  if (command === "import") {
    const source = resolve(positional[0] ?? "");
    if (!positional[0] || !existsSync(source)) throw new Error("import needs an existing file or product directory");
    let products;
    if ((await stat(source)).isDirectory()) {
      products = [await readProductByName(source)];
    } else {
      const bundle = JSON.parse(await readFile(source, "utf8"));
      if (bundle.schema !== BUNDLE) throw new Error(`not a product bundle: ${bundle.schema}`);
      products = bundle.products ?? [];
    }
    const known = await researchIds();
    let written = 0;
    for (const product of products) {
      const id = typeof flags.as === "string" ? flags.as : product.meta.id;
      if (!slug.test(id ?? "")) throw new Error(`bad id "${id}"`);
      const target = join(ITEMS, id);
      if (existsSync(target) && !flags.force) {
        throw new Error(`${id} already exists — pass --force to overwrite or --as <new-id> to keep both`);
      }
      const meta = { ...product.meta, id };
      const check = validate({ meta, notes: product.notes }, known);
      if (check.length) {
        console.log(red(`✗ ${id} rejected, nothing written`));
        for (const problem of check) console.log(`    ${problem}`);
        process.exitCode = 1;
        continue;
      }
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "product.json"), `${JSON.stringify(meta, null, 2)}\n`);
      await writeFile(join(target, "notes.zh.md"), product.notes.zh ?? "");
      await writeFile(join(target, "notes.en.md"), product.notes.en ?? "");
      written += 1;
      console.log(`${green("imported")} ${id}`);
    }
    if (written) await writeIndex();
    return;
  }

  if (command === "stats") {
    const products = await loadAll();
    const entries = sorted(products).map(indexEntry);
    let bytes = 0;
    for (const product of products) {
      const dir = join(ITEMS, product.meta.id);
      for (const name of await readdir(dir)) {
        const full = join(dir, name);
        if ((await stat(full)).isFile()) bytes += (await stat(full)).size;
      }
    }
    const words = products.reduce((sum, product) => sum + countWords(product.notes.zh), 0);
    const tally = (key) =>
      Object.entries(entries.reduce((acc, entry) => ({ ...acc, [entry[key]]: (acc[entry[key]] ?? 0) + 1 }), {}))
        .map(([name, count]) => `${name} ${count}`)
        .join("  ");
    console.log(`${bold(String(products.length))} products · ${words} zh words · ${(bytes / 1024).toFixed(1)} kB`);
    console.log(dim("category  ") + tally("category"));
    console.log(dim("stage     ") + tally("stage"));
    const research = entries.flatMap((entry) => entry.research);
    if (research.length) console.log(dim("research  ") + research.join("  "));
    return;
  }

  throw new Error(
    `unknown command "${command}" — try list, search, show, new, validate, index, export, import, stats`,
  );
}

/** A directory anywhere on disk that looks like a product. */
async function readProductByName(dir) {
  const meta = JSON.parse(await readFile(join(dir, "product.json"), "utf8"));
  const read = async (file) => (existsSync(join(dir, file)) ? readFile(join(dir, file), "utf8") : "");
  return { meta, notes: { zh: await read("notes.zh.md"), en: await read("notes.en.md") } };
}

/**
 * `schema.json` is what an editor completes against; `catalog.json` is what the
 * validator enforces. They drift the moment a category is added in one place.
 */
async function catalogDrift() {
  try {
    const schema = JSON.parse(await readFile(join(ROOT, "product", "schema.json"), "utf8"));
    const problems = [];
    const pairs = [
      ["category", CATEGORIES, schema.properties?.category?.enum],
      ["stage", STAGES, schema.properties?.stage?.enum],
      ["link kind", LINK_KINDS, schema.properties?.links?.items?.properties?.kind?.enum],
    ];
    for (const [key, ids, enumList] of pairs) {
      const listed = enumList ?? [];
      if (!listed.length) continue;
      const missing = ids.filter((id) => !listed.includes(id));
      const extra = listed.filter((id) => !ids.includes(id));
      if (missing.length) problems.push(`schema.json's ${key} enum is missing ${missing.join(", ")}`);
      if (extra.length) problems.push(`schema.json's ${key} enum still lists ${extra.join(", ")}`);
    }
    return problems;
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error(red(error.message));
  process.exitCode = 1;
});
