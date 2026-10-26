#!/usr/bin/env node
/**
 * The research ledger, from the terminal.
 *
 * A topic is a directory: `topic.json`, `notes.zh.md`, `notes.en.md`, and
 * optionally `data/`. Everything here works on that shape and nothing else —
 * no database, no index service. With a few dozen topics a linear scan beats
 * anything with a query planner, and the files stay diffable.
 *
 *   npm run research -- list --track=performance
 *   npm run research -- search "着色器 CPU"
 *   npm run research -- index
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
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
const TOPICS = join(ROOT, "research", "topics");
const INDEX = join(ROOT, "research", "index.json");
const PUBLIC = join(ROOT, "public", "research");
const TAXONOMY = join(ROOT, "research", "taxonomy.json");

const SCHEMA = "idefinity.research.topic/1";
const BUNDLE = "idefinity.research.bundle/1";

/**
 * What the facets are allowed to say, and in what order they appear on the
 * shelf. It lives in a file because adding a track should not mean editing
 * four other places: the validator, the index, the panel and the article.
 *
 * The fallback below is only here so a missing file cannot take the whole site
 * down; `taxonomy.json` is the source.
 */
const FALLBACK_TAXONOMY = {
  schema: "idefinity.taxonomy/1",
  tracks: [
    { id: "rendering", zh: "图形", en: "Rendering" },
    { id: "performance", zh: "性能", en: "Performance" },
    { id: "data", zh: "数据", en: "Data" },
    { id: "interface", zh: "界面", en: "Interface" },
    { id: "tooling", zh: "工具", en: "Tooling" },
    { id: "writing", zh: "写作", en: "Writing" },
  ],
  kinds: [
    { id: "study", zh: "读", en: "Study" },
    { id: "experiment", zh: "实测", en: "Experiment" },
    { id: "note", zh: "记录", en: "Note" },
    { id: "decision", zh: "取舍", en: "Decision" },
  ],
  statuses: [
    { id: "idea", zh: "想法", en: "Idea" },
    { id: "active", zh: "进行中", en: "Active" },
    { id: "shipped", zh: "已落地", en: "Shipped" },
    { id: "paused", zh: "暂停", en: "Paused" },
    { id: "dropped", zh: "放弃", en: "Dropped" },
  ],
  series: [],
};

async function readTaxonomy() {
  try {
    const raw = JSON.parse(await readFile(TAXONOMY, "utf8"));
    // Take the file field by field: one missing list should not throw away the
    // other three.
    const list = (key, fallback) => {
      const value = raw[key];
      if (!Array.isArray(value) || !value.length) return fallback;
      return value
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => ({ ...entry, zh: entry.zh ?? entry.id, en: entry.en ?? entry.id }));
    };
    return {
      schema: raw.schema ?? FALLBACK_TAXONOMY.schema,
      tracks: list("tracks", FALLBACK_TAXONOMY.tracks),
      kinds: list("kinds", FALLBACK_TAXONOMY.kinds),
      statuses: list("statuses", FALLBACK_TAXONOMY.statuses),
      series: list("series", FALLBACK_TAXONOMY.series),
    };
  } catch {
    return FALLBACK_TAXONOMY;
  }
}

const TAXONOMY_DATA = await readTaxonomy();
const TRACKS = TAXONOMY_DATA.tracks.map((entry) => entry.id);
const KINDS = TAXONOMY_DATA.kinds.map((entry) => entry.id);
const STATUSES = TAXONOMY_DATA.statuses.map((entry) => entry.id);
const SERIES = TAXONOMY_DATA.series.map((entry) => entry.id);

/* ---------- reading ---------- */

async function readTopic(id) {
  const dir = join(TOPICS, id);
  const meta = JSON.parse(await readFile(join(dir, "topic.json"), "utf8"));
  const read = async (file) =>
    existsSync(join(dir, file)) ? readFile(join(dir, file), "utf8") : "";
  const data = {};
  const dataDir = join(dir, "data");
  if (existsSync(dataDir)) {
    for (const name of await readdir(dataDir)) {
      const full = join(dataDir, name);
      if ((await stat(full)).isFile()) data[`data/${name}`] = await readFile(full, "utf8");
    }
  }
  return {
    meta,
    notes: { zh: await read("notes.zh.md"), en: await read("notes.en.md") },
    data,
  };
}

async function loadAll() {
  if (!existsSync(TOPICS)) return [];
  const names = (await readdir(TOPICS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const topics = [];
  for (const name of names) {
    try {
      const topic = await readTopic(name);
      if (topic.meta.id !== name) {
        topic.problems = [`folder is "${name}" but id is "${topic.meta.id}"`];
      }
      topics.push(topic);
    } catch (error) {
      topics.push({ meta: { id: name, title: { zh: name }, track: "tooling", kind: "note", status: "dropped", questions: [], updated: "1970-01-01" }, notes: { zh: "", en: "" }, data: {}, problems: [String(error.message)] });
    }
  }
  return topics;
}

/* ---------- validating ---------- */

function validate(topic) {
  const errors = [...(topic.problems ?? [])];
  const m = topic.meta;
  if (m.schema && m.schema !== SCHEMA) errors.push(`schema must be "${SCHEMA}"`);
  if (!slug.test(m.id ?? "")) errors.push("id must be a lowercase slug (a-z, 0-9, single dashes)");
  if ((m.id ?? "").length > 48) errors.push("id is longer than 48 characters");
  for (const key of ["title"]) {
    if (!m[key]?.zh) errors.push(`${key}.zh is required`);
  }
  if (!TRACKS.includes(m.track)) errors.push(`track must be one of ${TRACKS.join(", ")}`);
  if (!KINDS.includes(m.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!STATUSES.includes(m.status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);
  const questions = m.questions;
  const list = (value, field) => {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`questions.${field} needs at least one entry — it is what the search leans on`);
      return;
    }
    if (value.length > 5) errors.push(`questions.${field} caps at 5`);
    for (const question of value) {
      if (typeof question !== "string" || question.length < 6) {
        errors.push(`questions.${field} has a stub: "${question}"`);
      }
    }
  };
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    errors.push("questions is an object with zh (and preferably en) arrays");
  } else {
    list(questions.zh, "zh");
    if (questions.en) list(questions.en, "en");
  }
  if (!isDate(m.updated ?? "")) errors.push("updated must be YYYY-MM-DD");
  if (m.created && !isDate(m.created)) errors.push("created must be YYYY-MM-DD");
  if (m.tags && (!Array.isArray(m.tags) || m.tags.some((tag) => !/^[a-z0-9][a-z0-9+-]*$/.test(tag)))) {
    errors.push("tags are lowercase words; no spaces");
  }
  // A series is the one classification that crosses tracks — "the loop" holds a
  // rendering entry and a performance one. It is declared in taxonomy.json so a
  // typo shows up here instead of quietly making a series of one.
  if (m.series !== undefined) {
    if (!Array.isArray(m.series)) errors.push("series is a list of ids");
    else {
      for (const id of m.series) {
        if (!SERIES.includes(id)) {
          errors.push(`unknown series "${id}" — add it to research/taxonomy.json first`);
        }
      }
    }
  }
  if (!topic.notes.zh.trim()) errors.push("notes.zh.md is empty");
  if (!topic.notes.en.trim()) errors.push("notes.en.md is empty (the site is bilingual)");
  for (const path of Object.values(m.metrics ?? {})) {
    if (!topic.data[path]) errors.push(`metrics points at a missing file: ${path}`);
  }
  const known = new Set(Object.keys(topic.data));
  for (const path of known) {
    if (!Object.values(m.metrics ?? {}).includes(path) && !m.links?.some((l) => l.href === path)) {
      errors.push(`${path} is in data/ but nothing references it`);
    }
  }
  return errors;
}

/* ---------- searching ---------- */

const WEIGHTS = { id: 3, title: 4, questions: 2.5, tags: 2, summary: 2, body: 1 };

function score(topic, query) {
  return rank(
    {
      id: topic.meta.id.replace(/-/g, " "),
      title: `${topic.meta.title?.zh ?? ""} ${topic.meta.title?.en ?? ""}`,
      questions: [...(topic.meta.questions?.zh ?? []), ...(topic.meta.questions?.en ?? [])].join(" "),
      tags: (topic.meta.tags ?? []).join(" "),
      summary: `${topic.meta.summary?.zh ?? ""} ${topic.meta.summary?.en ?? ""}`,
      body: `${topic.notes.zh} ${topic.notes.en}`,
    },
    WEIGHTS,
    query,
  );
}

/* ---------- writing ---------- */

function indexEntry(topic) {
  const { meta, notes } = topic;
  const words = { zh: countWords(notes.zh), en: countWords(notes.en) };
  return {
    id: meta.id,
    title: meta.title,
    summary: meta.summary ?? { zh: notes.zh.split("\n").find((line) => line && !line.startsWith("#")) ?? "" },
    track: meta.track,
    kind: meta.kind,
    status: meta.status,
    tags: meta.tags ?? [],
    series: meta.series ?? [],
    questions: meta.questions,
    verdict: meta.verdict ?? "",
    updated: meta.updated,
    created: meta.created ?? meta.updated,
    words,
    // 400 hanzi a minute, 220 English words. Rounded up, minimum one.
    minutes: Math.max(1, Math.round((words.zh / 400 + words.en / 220) / 2)),
  };
}

async function writeIndex() {
  const topics = await loadAll();
  const bad = topics.filter((topic) => validate(topic).length);
  if (bad.length) {
    console.error(red(`refusing to index ${bad.length} invalid topic(s):`));
    for (const topic of bad) console.error(`  ${topic.meta.id}: ${validate(topic).join("; ")}`);
    process.exitCode = 1;
    return;
  }
  const entries = topics.map(indexEntry).sort((a, b) => b.updated.localeCompare(a.updated));
  const tally = (key) =>
    entries.reduce((acc, entry) => {
      acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
      return acc;
    }, {});
  // Series are a list per entry, so they cannot ride the single-value tally.
  const bySeries = {};
  for (const entry of entries) {
    for (const id of entry.series ?? []) bySeries[id] = (bySeries[id] ?? 0) + 1;
  }
  const payload = {
    schema: "idefinity.research.index/1",
    generated: new Date().toISOString(),
    // The shelf's vocabulary rides along, so the page needs one request and a
    // new track never has to be typed into the front end.
    taxonomy: TAXONOMY_DATA,
    counts: {
      topics: entries.length,
      byTrack: tally("track"),
      byKind: tally("kind"),
      byStatus: tally("status"),
      bySeries,
    },
    topics: entries,
  };

  await mkdir(join(ROOT, "research"), { recursive: true });
  await writeFile(INDEX, `${JSON.stringify(payload, null, 2)}\n`);

  // The site reads the same file plus one payload per topic, so a detail page
  // costs a single small request and nothing else has to be parsed.
  await rm(PUBLIC, { recursive: true, force: true });
  await mkdir(join(PUBLIC, "topics"), { recursive: true });
  await writeFile(join(PUBLIC, "index.json"), `${JSON.stringify(payload, null, 2)}\n`);
  for (const topic of topics) {
    const detail = { ...indexEntry(topic), notes: topic.notes, data: topic.data, links: topic.meta.links ?? [] };
    await writeFile(join(PUBLIC, "topics", `${topic.meta.id}.json`), `${JSON.stringify(detail, null, 2)}\n`);
  }
  console.log(
    `${green("indexed")} ${entries.length} topic(s) ${dim(`→ research/index.json, public/research/`)}`,
  );
  return payload;
}

/* ---------- commands ---------- */

function printTable(entries) {
  const pad = (value, width) => String(value).padEnd(width);
  const idWidth = Math.max(12, ...entries.map((entry) => entry.id.length)) + 2;
  for (const entry of entries) {
    const status = entry.status === "shipped" ? green(entry.status) : entry.status === "active" ? gold(entry.status) : dim(entry.status);
    console.log(
      `${pad(entry.id, idWidth)}${dim(pad(entry.track, 13))}${dim(pad(entry.kind, 12))}${pad(status, 20)}${dim(entry.updated)}`,
    );
    console.log(`${" ".repeat(idWidth + 45)}${dim(text(entry.title))}`);
  }
}

async function main() {
  const [command = "list", ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  if (command === "list") {
    const topics = (await loadAll()).map(indexEntry);
    let entries = topics;
    if (flags.track) entries = entries.filter((entry) => entry.track === flags.track);
    if (flags.kind) entries = entries.filter((entry) => entry.kind === flags.kind);
    if (flags.status) entries = entries.filter((entry) => entry.status === flags.status);
    if (flags.tag) entries = entries.filter((entry) => entry.tags.includes(flags.tag));
    if (flags.series) entries = entries.filter((entry) => entry.series.includes(flags.series));
    entries.sort((a, b) => b.updated.localeCompare(a.updated));
    if (!entries.length) console.log(dim("nothing matches"));
    else printTable(entries);
    return;
  }

  if (command === "search") {
    const query = positional.join(" ");
    if (!query) throw new Error('search needs a query, e.g. npm run research -- search "接缝"');
    const topics = await loadAll();
    const ranked = topics
      .map((topic) => ({ topic, ...score(topic, query) }))
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
      console.log(`${gold(bar)} ${String(percent).padStart(3)}%  ${bold(row.topic.meta.id)}`);
      console.log(`        ${text(row.topic.meta.title)}`);
    }
    return;
  }

  if (command === "show") {
    const id = positional[0];
    if (!id) throw new Error("show needs a topic id");
    const topic = await readTopic(id);
    const problems = validate(topic);
    console.log(`${bold(text(topic.meta.title))}  ${dim(topic.meta.id)}`);
    console.log(
      dim(
        `${topic.meta.track} / ${topic.meta.kind} / ${topic.meta.status} · updated ${topic.meta.updated} · ${countWords(topic.notes.zh)} words zh`,
      ),
    );
    for (const question of topic.meta.questions?.zh ?? []) console.log(`  ? ${question}`);
    if (topic.meta.series?.length) console.log(dim(`  series: ${topic.meta.series.join(", ")}`));
    if (topic.meta.verdict) console.log(`\n${gold("verdict")} ${topic.meta.verdict}`);
    console.log(`\n${topic.notes.zh.trim()}`);
    if (problems.length) {
      console.log(red(`\n${problems.length} problem(s):`));
      for (const problem of problems) console.log(red(`  - ${problem}`));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "validate") {
    const topics = await loadAll();
    let failures = 0;
    // taxonomy.json is the source; schema.json is what an editor reads. They
    // drift silently the moment a new track is added in one place only.
    for (const problem of await schemaDrift()) {
      failures += 1;
      console.log(red(`✗ ${problem}`));
    }
    for (const topic of topics) {
      const problems = validate(topic);
      if (problems.length) {
        failures += 1;
        console.log(red(`✗ ${topic.meta.id}`));
        for (const problem of problems) console.log(`    ${problem}`);
      } else {
        console.log(`${green("✓")} ${topic.meta.id}`);
      }
    }
    const ids = new Set(topics.map((topic) => topic.meta.id));
    if (ids.size !== topics.length) {
      failures += 1;
      console.log(red("✗ duplicate ids"));
    }
    if (failures) {
      process.exitCode = 1;
      console.log(red(`\n${failures} topic(s) need fixing`));
    } else {
      console.log(green(`\nall ${topics.length} topic(s) valid`));
    }
    return;
  }

  if (command === "index") {
    await writeIndex();
    return;
  }

  if (command === "new") {
    const id = positional[0];
    if (!id || !slug.test(id)) throw new Error("new needs a slug id, e.g. loop-dpr");
    const dir = join(TOPICS, id);
    if (existsSync(dir)) throw new Error(`${id} already exists`);
    const track = flags.track ?? "rendering";
    const kind = flags.kind ?? "experiment";
    if (!TRACKS.includes(track)) throw new Error(`track must be one of ${TRACKS.join(", ")}`);
    if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
    const today = new Date().toISOString().slice(0, 10);
    await mkdir(dir, { recursive: true });
    const meta = {
      schema: SCHEMA,
      id,
      title: { zh: "改了标题再往下写", en: "Replace this title" },
      summary: { zh: "", en: "" },
      track,
      kind,
      status: "idea",
      questions: {
        zh: ["这里写第一个要回答的问题，一个问题一行"],
        en: ["Write the first question to answer, one per line"],
      },
      tags: [],
      series: [],
      owner: "zziang",
      created: today,
      updated: today,
      links: [],
    };
    await writeFile(join(dir, "topic.json"), `${JSON.stringify(meta, null, 2)}\n`);
    await writeFile(join(dir, "notes.zh.md"), `# ${meta.title.zh}\n\n还没开始。先把问题写清楚。\n`);
    await writeFile(join(dir, "notes.en.md"), `# ${meta.title.en}\n\nNot started. Write the question down first.\n`);
    console.log(`${green("created")} research/topics/${id}/`);
    return;
  }

  if (command === "export") {
    const ids = positional.length ? positional : (await loadAll()).map((topic) => topic.meta.id);
    const topics = [];
    for (const id of ids) {
      const topic = await readTopic(id);
      topics.push({ meta: topic.meta, notes: topic.notes, data: topic.data });
    }
    const bundle = {
      schema: BUNDLE,
      exported: new Date().toISOString(),
      topics,
    };
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    if (flags.out) {
      await writeFile(resolve(flags.out), json);
      console.log(`${green("exported")} ${topics.length} topic(s) → ${flags.out} ${dim(`${(json.length / 1024).toFixed(1)} kB`)}`);
    } else {
      process.stdout.write(json);
    }
    return;
  }

  if (command === "import") {
    const source = resolve(positional[0] ?? "");
    if (!positional[0] || !existsSync(source)) throw new Error("import needs an existing file or topic directory");
    let topics;
    if ((await stat(source)).isDirectory()) {
      const topic = await readTopicByName(source);
      topics = [topic];
    } else {
      const bundle = JSON.parse(await readFile(source, "utf8"));
      if (bundle.schema !== BUNDLE) throw new Error(`not a research bundle: ${bundle.schema}`);
      topics = bundle.topics ?? [];
    }
    let written = 0;
    for (const topic of topics) {
      const id = typeof flags.as === "string" ? flags.as : topic.meta.id;
      if (!slug.test(id ?? "")) throw new Error(`bad id "${id}"`);
      const target = join(TOPICS, id);
      if (existsSync(target) && !flags.force) {
        throw new Error(`${id} already exists — pass --force to overwrite or --as <new-id> to keep both`);
      }
      const meta = { ...topic.meta, id };
      const check = validate({ meta, notes: topic.notes, data: topic.data ?? {} });
      if (check.length) {
        console.log(red(`✗ ${id} rejected, nothing written`));
        for (const problem of check) console.log(`    ${problem}`);
        process.exitCode = 1;
        continue;
      }
      await rm(target, { recursive: true, force: true });
      await mkdir(join(target, "data"), { recursive: true });
      await writeFile(join(target, "topic.json"), `${JSON.stringify(meta, null, 2)}\n`);
      await writeFile(join(target, "notes.zh.md"), topic.notes.zh ?? "");
      await writeFile(join(target, "notes.en.md"), topic.notes.en ?? "");
      for (const [path, content] of Object.entries(topic.data ?? {})) {
        // Data paths are relative to the topic directory and must stay inside it.
        const full = resolve(target, path);
        if (!full.startsWith(target + sep)) throw new Error(`refusing path outside the topic: ${path}`);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content);
      }
      written += 1;
      console.log(`${green("imported")} ${id}`);
    }
    if (written) await writeIndex();
    return;
  }

  if (command === "stats") {
    const topics = await loadAll();
    const bytes = (await Promise.all(
      topics.map(async (topic) => {
        const dir = join(TOPICS, topic.meta.id);
        let total = 0;
        const walk = async (path) => {
          for (const entry of await readdir(path, { withFileTypes: true })) {
            const full = join(path, entry.name);
            total += entry.isDirectory() ? (await walk(full), 0) : (await stat(full)).size;
          }
        };
        await walk(dir);
        return total;
      }),
    )).reduce((a, b) => a + b, 0);
    const words = topics.reduce((sum, topic) => sum + countWords(topic.notes.zh), 0);
    const entries = topics.map(indexEntry);
    const tally = (key) =>
      Object.entries(entries.reduce((acc, entry) => ({ ...acc, [entry[key]]: (acc[entry[key]] ?? 0) + 1 }), {}))
        .map(([name, count]) => `${name} ${count}`)
        .join("  ");
    console.log(`${bold(String(topics.length))} topics · ${words} zh words · ${(bytes / 1024).toFixed(1)} kB`);
    console.log(dim("track     ") + tally("track"));
    console.log(dim("kind      ") + tally("kind"));
    console.log(dim("status    ") + tally("status"));
    const series = {};
    for (const entry of entries) {
      for (const id of entry.series ?? []) series[id] = (series[id] ?? 0) + 1;
    }
    if (Object.keys(series).length) {
      console.log(
        dim("series    ") +
          Object.entries(series)
            .map(([id, count]) => `${id} ${count}`)
            .join("  "),
      );
    }
    const fingerprints = await Promise.all(
      topics.map(async (topic) => {
        const raw = await readFile(join(TOPICS, topic.meta.id, "topic.json"), "utf8");
        return createHash("sha1").update(raw).digest("hex").slice(0, 8);
      }),
    );
    console.log(dim("fingerprints ") + fingerprints.join(" "));
    return;
  }

  throw new Error(`unknown command "${command}" — try list, search, show, new, validate, index, export, import, stats`);
}

/**
 * Compares the enums an editor sees against the vocabulary the CLI enforces.
 * Returns [] when there is no schema file — not every checkout needs one.
 */
async function schemaDrift() {
  try {
    const schema = JSON.parse(await readFile(join(ROOT, "research", "schema.json"), "utf8"));
    const problems = [];
    const pairs = [
      ["track", TRACKS],
      ["kind", KINDS],
      ["status", STATUSES],
    ];
    for (const [key, ids] of pairs) {
      const listed = schema.properties?.[key]?.enum ?? [];
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

/** A directory anywhere on disk that looks like a topic. */
async function readTopicByName(dir) {
  const meta = JSON.parse(await readFile(join(dir, "topic.json"), "utf8"));
  const read = async (file) => (existsSync(join(dir, file)) ? readFile(join(dir, file), "utf8") : "");
  const data = {};
  const dataDir = join(dir, "data");
  if (existsSync(dataDir)) {
    for (const name of await readdir(dataDir)) {
      if ((await stat(join(dataDir, name))).isFile()) {
        data[`data/${name}`] = await readFile(join(dataDir, name), "utf8");
      }
    }
  }
  return { meta, notes: { zh: await read("notes.zh.md"), en: await read("notes.en.md") }, data };
}

main().catch((error) => {
  console.error(red(error.message));
  process.exitCode = 1;
});
