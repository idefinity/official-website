/**
 * The product catalogue and one product's page.
 *
 * `product.html` without `?id=` is the catalogue; with `?id=<slug>` it is that
 * product. Same pattern as `research.html`, for the same reason: one document,
 * one static host, no router. No three.js here — a product page should open on
 * a phone with two bars of signal.
 */
import "./tokens.css";
import "./ui.css";
import "./article.css";
import "./product.css";
import { loadIndex } from "./research.ts";
import {
  loadProductIndex,
  readProduct,
  type Language,
  type ProductIndex,
} from "./product.ts";
import { pick } from "./product-types.ts";
import {
  renderCatalogGrid,
  renderCatalogHeader,
  renderMissing,
  renderProductDetail,
  type RelatedTopic,
} from "./product-markup.ts";

const params = new URLSearchParams(location.search);
const slug = params.get("id") ?? "";
let language: Language = params.get("lang") === "en" ? "en" : "zh";

const COPY = {
  zh: {
    section: "产品",
    home: "首页",
    all: "全部产品",
    switch: "EN",
    catalogTitle: "产品目录 — idefinity",
  },
  en: {
    section: "Products",
    home: "Home",
    all: "All products",
    switch: "中文",
    catalogTitle: "Products — idefinity",
  },
} as const;

const copy = () => COPY[language];
const body = document.querySelector<HTMLElement>("#product")!;
const header = document.querySelector<HTMLElement>(".ledger-head")!;

function paintChrome(current: string) {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  const back = header.querySelector<HTMLAnchorElement>("[data-copy='back']")!;
  const here = header.querySelector<HTMLElement>("[data-copy='current']")!;
  if (current) {
    back.textContent = copy().section;
    back.href = language === "en" ? "product.html?lang=en" : "product.html";
  } else {
    back.textContent = copy().home;
    back.href = language === "en" ? "/?lang=en" : "/";
  }
  here.textContent = current || copy().section;

  const toggle = header.querySelector<HTMLButtonElement>("#product-language")!;
  toggle.textContent = copy().switch;
  toggle.setAttribute(
    "aria-label",
    language === "en" ? "切换到中文" : "Switch to English",
  );
}

function toggleLanguage() {
  const url = new URL(location.href);
  if (language === "en") url.searchParams.delete("lang");
  else url.searchParams.set("lang", "en");
  location.href = url.toString();
}

/* ---------- the catalogue ---------- */

function validCategory(index: ProductIndex, id: string | null): string | null {
  if (!id) return null;
  return index.products.some((product) => product.category === id) ? id : null;
}

function showCatalog(index: ProductIndex, requested: string | null) {
  const state = { category: validCategory(index, requested) };
  const view = () => ({ index, language, category: state.category });

  paintChrome("");
  document.title = copy().catalogTitle;
  body.innerHTML = renderCatalogHeader(view()) + renderCatalogGrid(view());
  body.dataset.state = "catalog";
  body.classList.add("catalog-body");
  syncUrl();

  const filters = body.querySelector<HTMLElement>(".product-filters");
  if (!filters) return;

  const mark = () => {
    for (const chip of filters.querySelectorAll<HTMLElement>("[data-category]")) {
      chip.setAttribute(
        "aria-pressed",
        String((chip.dataset.category || null) === state.category),
      );
    }
  };
  mark();

  filters.addEventListener("click", (event) => {
    const chip =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-category]")
        : null;
    if (!chip) return;
    state.category = chip.dataset.category || null;
    const grid = body.querySelector(".product-grid");
    if (grid) grid.outerHTML = renderCatalogGrid(view());
    mark();
    syncUrl();
  });

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("id");
    if (state.category) url.searchParams.set("category", state.category);
    else url.searchParams.delete("category");
    if (language === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    history.replaceState(null, "", url);
  }
}

/* ---------- one product ---------- */

async function relatedTopics(ids: string[]): Promise<RelatedTopic[]> {
  if (!ids.length) return [];
  try {
    const index = await loadIndex();
    const found: RelatedTopic[] = [];
    for (const id of ids) {
      const topic = index.topics.find((entry) => entry.id === id);
      if (topic) found.push({ id: topic.id, title: pick(topic.title, language) });
    }
    return found;
  } catch {
    return [];
  }
}

async function showProduct(id: string) {
  const product = await readProduct(id);
  // The catalogue only supplies the vocabulary (category and stage names) and
  // is allowed to fail: the product payload stands on its own.
  const index = await loadProductIndex().catch(() => null);
  const related = await relatedTopics(product.research ?? []);

  paintChrome(product.name);
  document.title = `${product.name} — idefinity`;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = pick(product.tagline, language);

  // Same reasoning as the research page: a product is not the catalogue.
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) {
    const url = new URL(location.href);
    url.search = `?id=${encodeURIComponent(product.id)}`;
    url.hash = "";
    canonical.href = url.toString();
  }

  body.innerHTML = renderProductDetail(product, index?.catalog, related, language);
  body.dataset.state = "ready";
  body.classList.add("product-body");
}

function showMissing() {
  paintChrome("");
  body.innerHTML = renderMissing(language);
  body.dataset.state = "missing";
}

async function boot() {
  paintChrome("");
  header
    .querySelector("#product-language")
    ?.addEventListener("click", toggleLanguage);

  if (!slug) {
    try {
      showCatalog(await loadProductIndex(), params.get("category"));
    } catch {
      showMissing();
    }
    return;
  }

  try {
    await showProduct(slug);
  } catch {
    showMissing();
  }
}

void boot();
