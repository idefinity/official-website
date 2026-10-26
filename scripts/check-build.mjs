/**
 * The gate that needs neither a browser nor a server.
 *
 * Most pushes change an article, not the code that renders it, and downloading
 * Chromium to find out that a topic was never indexed is the wrong trade. These
 * assertions read the built tree instead: every index entry has its payload, the
 * payload carries both languages, the sitemap lists what the indexes list, the
 * documents point at assets that exist, and the homepage panel was rendered at
 * build time rather than falling back. What only a live page can tell you — the
 * renderer mounted, the deck responds to keys, the language switch works — is
 * still `npm run check`.
 *
 *   npm run build && npm run check:build
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CHECK_DIST || "dist";
const failures = [];
let checks = 0;

if (!existsSync(root)) {
  console.error(`no ${root}/ — run npm run build first.`);
  process.exit(1);
}

function expect(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

const exists = (path) => existsSync(join(root, path));

function text(path) {
  checks += 1;
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    failures.push(`${path} is missing from the build`);
    return "";
  }
}

function json(path) {
  const source = text(path);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    failures.push(`${path} is not valid JSON`);
    return null;
  }
}

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );

// A product is named the same in both languages; a topic is titled twice.
const both = (field, where) => {
  if (typeof field === "string") {
    expect(field.trim() !== "", `${where} is empty`);
    return;
  }
  for (const lang of ["zh", "en"]) {
    expect((field?.[lang] ?? "").trim() !== "", `${where} has no ${lang}`);
  }
};

// 1. An entry that is indexed but not shipped is a 404 the moment someone
//    shares the link, so the index and the payload files have to agree.
const indexes = [
  {
    name: "research",
    index: json("research/index.json")?.topics ?? [],
    payload: (id) => `research/topics/${id}.json`,
  },
  {
    name: "product",
    index: json("product/index.json")?.products ?? [],
    payload: (id) => `product/items/${id}.json`,
  },
];

for (const { name, index, payload } of indexes) {
  expect(index.length > 0, `${name}/index.json lists nothing — did the index step run?`);
  for (const entry of index) {
    const body = json(payload(entry.id));
    if (!body) continue;
    expect(body.id === entry.id, `${payload(entry.id)} calls itself "${body.id}"`);
    both(body.title ?? body.name, `${name} ${entry.id} title`);
    both(body.notes, `${name} ${entry.id} notes`);
  }
}

// 2. The sitemap is generated from the same indexes, so an entry missing here
//    means a page that exists but will never be found.
const map = text("sitemap.xml");
expect(map.startsWith('<?xml version="1.0"'), "sitemap.xml should be an XML document");
for (const page of ["", "research.html", "product.html"]) {
  expect(map.includes(`<loc>https://idefinity.com/${page}</loc>`), `the sitemap is missing /${page}`);
}
for (const topic of indexes[0].index) {
  expect(map.includes(`research.html?id=${topic.id}`), `the sitemap is missing "${topic.id}"`);
}
for (const product of indexes[1].index) {
  expect(map.includes(`product.html?id=${product.id}`), `the sitemap is missing "${product.id}"`);
}
expect(!/undefined|\[object|NaN/.test(map), "the sitemap carries a broken field");

// 3. A document that references a chunk the build did not emit loads as a blank
//    page, and nothing else here would notice.
for (const page of ["index.html", "research.html", "product.html"]) {
  const html = text(page);
  expect(
    html.includes(`<link rel="canonical" href="https://idefinity.com/${page === "index.html" ? "" : page}" />`),
    `${page} lost its canonical`,
  );
  for (const reference of html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)) {
    expect(exists(reference[1]), `${page} refers to ${reference[1]}, which is not in the build`);
  }
}

// 4. The homepage panel is rendered at build time from the product index. If the
//    index was unreadable the build still succeeds, with this in its place.
expect(
  !text("index.html").includes("product-empty"),
  "the homepage product panel fell back to the empty notice",
);

// 5. macOS writes AppleDouble sidecars next to files; a tarball carries them and
//    they end up served as /._index.html.
const strays = files(root).filter((file) => /(^|\/)(\._|\.DS_Store)/.test(file));
expect(strays.length === 0, `the build ships files that are not content: ${strays.join(", ")}`);

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} build checks passed.`);
