/**
 * The shape of a product, and the few functions that only need that shape.
 *
 * Kept free of `window`, `fetch` and `import.meta.env` on purpose: the same
 * module is imported by `vite.config.ts`, which runs in Node and renders the
 * homepage panel before any JavaScript ships.
 */

export interface Localized {
  zh: string;
  en?: string;
}

export interface Facet {
  id: string;
  zh: string;
  en: string;
}

export interface Catalog {
  schema?: string;
  categories: Facet[];
  stages: Facet[];
}

export interface Highlight {
  title: Localized;
  text: Localized;
}

export interface Fact {
  label: Localized;
  value: Localized;
}

export interface ProductLink {
  kind: "repo" | "docs" | "download" | "demo";
  label: Localized;
  href: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  tagline: Localized;
  summary: Localized;
  category: string;
  stage: string;
  version: string;
  notice?: Localized;
  highlights: Highlight[];
  facts: Fact[];
  links: ProductLink[];
  research: string[];
  order: number | null;
  updated: string;
  created: string;
  words: { zh: number; en: number };
  minutes: number;
}

export interface ProductDetail extends ProductSummary {
  notes: { zh: string; en: string };
}

export interface ProductIndex {
  schema: string;
  generated: string;
  catalog?: Catalog;
  counts: {
    products: number;
    byCategory: Record<string, number>;
    byStage: Record<string, number>;
  };
  products: ProductSummary[];
}

export type Language = "zh" | "en";

export const pick = (value: Localized | undefined, language: Language): string =>
  (language === "en" ? value?.en || value?.zh : value?.zh) ?? "";

/** Display name for a facet id, falling back to the id itself. */
export function nameFor(
  catalog: Catalog | undefined,
  group: "categories" | "stages",
  id: string,
  language: Language,
): string {
  const entry = catalog?.[group]?.find((item) => item.id === id);
  return entry ? pick(entry, language) || id : id;
}

/**
 * Product URLs are relative, unlike the research ones. A relative link resolves
 * against whatever the page is served from, so a preview under a subpath and
 * the domain root behave the same without threading `base` through the build.
 */
export function productUrl(id: string, language: Language): string {
  const query = `?id=${encodeURIComponent(id)}${language === "en" ? "&lang=en" : ""}`;
  return `product.html${query}`;
}

export function catalogUrl(
  options: { category?: string | null } = {},
  language: Language = "zh",
): string {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (language === "en") params.set("lang", "en");
  const query = params.toString();
  return `product.html${query ? `?${query}` : ""}`;
}

/** `数据库 · 内测` — what this is and how far it got. */
export function facets(
  product: ProductSummary,
  language: Language,
  catalog?: Catalog,
): string {
  return [
    nameFor(catalog, "categories", product.category, language),
    nameFor(catalog, "stages", product.stage, language),
  ].join(" · ");
}

/** `v0.1.0 · 内测` — the line next to the status dot. */
export function stageLine(
  product: ProductSummary,
  language: Language,
  catalog?: Catalog,
): string {
  const stage = nameFor(catalog, "stages", product.stage, language);
  return product.version ? `v${product.version} · ${stage}` : stage;
}
