import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { renderProductPanel } from "./src/product-markup.ts";
import type { ProductIndex } from "./src/product-types.ts";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const data = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const PANEL_MARK = "<!-- @product-panel -->";

const SITE = "https://idefinity.com";

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * The sitemap is generated from the two indexes instead of being typed by hand.
 *
 * A hand-kept list is wrong the first time someone adds a product, and the
 * previous one had already drifted: research entries were never in it. Here a
 * page exists in the sitemap the moment its row exists in the index.
 */
function sitemap(): Plugin {
  return {
    name: "idefinity:sitemap",
    generateBundle() {
      const products = readJson<ProductIndex>(data("product/index.json"))?.products ?? [];
      const topics = readJson<{ topics: { id: string; updated?: string }[] }>(
        data("research/index.json"),
      )?.topics ?? [];

      type Entry = { path: string; lastmod?: string; changefreq: string; priority: string };
      // A collection page changes when its newest entry does — that is also when
      // the homepage panel changes, since the panel is built from the same data.
      const newest = (dates: (string | undefined)[]) =>
        dates.filter(Boolean).sort().pop();
      const newestProduct = newest(products.map((product) => product.updated));
      const newestTopic = newest(topics.map((topic) => topic.updated));

      const entries: Entry[] = [
        { path: "/", lastmod: newest([newestProduct, newestTopic]), changefreq: "monthly", priority: "1.0" },
        { path: "/research.html", lastmod: newestTopic, changefreq: "weekly", priority: "0.6" },
        { path: "/product.html", lastmod: newestProduct, changefreq: "monthly", priority: "0.8" },
        ...products.map((product) => ({
          path: `/product.html?id=${encodeURIComponent(product.id)}`,
          lastmod: product.updated,
          changefreq: "monthly",
          priority: "0.7",
        })),
        ...topics.map((topic) => ({
          path: `/research.html?id=${encodeURIComponent(topic.id)}`,
          lastmod: topic.updated,
          changefreq: "yearly",
          priority: "0.5",
        })),
      ];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${SITE}${entry.path.replace(/&/g, "&amp;")}</loc>
${entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : ""}    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: xml });
    },
  };
}

/**
 * The homepage's product panel, rendered once at build time from the same index
 * the client reads.
 *
 * The point is not speed — it is that `index.html` no longer holds a second copy
 * of the product copy. Product facts live in `product/items/*`, and what ships
 * is that data. With JavaScript off the panel is real, not a heading waiting for
 * a fetch; with JavaScript on, the client repaints the same block so the
 * language switch works.
 */
function productPanel(): Plugin {
  const indexFile = fileURLToPath(new URL("product/index.json", import.meta.url));
  return {
    name: "idefinity:product-panel",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!html.includes(PANEL_MARK)) return html;
        try {
          const index = JSON.parse(readFileSync(indexFile, "utf8")) as ProductIndex;
          return html.replace(PANEL_MARK, renderProductPanel(index, "zh"));
        } catch {
          // A missing index should not take the build down: the panel still has
          // its heading, and the next index run fills the block in.
          return html.replace(
            PANEL_MARK,
            `<p class="product-empty">产品清单还没生成，先跑 <code>npm run product -- index</code>。</p>`,
          );
        }
      },
    },
  };
}

// The company site is served from the domain root, so no base path rewriting
// is needed here. `SITE_BASE_PATH` stays available for a preview subpath.
export default defineConfig({
  base: process.env.SITE_BASE_PATH || "/",
  plugins: [productPanel(), sitemap()],
  build: {
    target: "es2022",
    rollupOptions: {
      // Three documents: the deck, one article page that renders any research
      // entry from its slug, and the product catalogue. Neither of the latter
      // two ships three.js, so they open like normal pages.
      input: {
        main: page("index.html"),
        research: page("research.html"),
        product: page("product.html"),
      },
    },
  },
});
