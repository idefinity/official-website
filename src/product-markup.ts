/**
 * Product HTML, as strings.
 *
 * One renderer for three places: the panel on the deck, the catalogue grid, and
 * a single product's page. The deck's copy is rendered here at *build* time too
 * (see `vite.config.ts`), so the homepage keeps a real product block when
 * JavaScript is off — and there is still only one template to maintain.
 *
 * Nothing in this file touches the DOM. It is imported by a Node process.
 */
import { renderMarkdown } from "./markdown.ts";
import {
  catalogUrl,
  facets,
  nameFor,
  pick,
  productUrl,
  stageLine,
  type Catalog,
  type Language,
  type ProductDetail,
  type ProductIndex,
  type ProductLink,
  type ProductSummary,
} from "./product-types.ts";

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  );

const COPY = {
  zh: {
    section: "产品",
    others: "其他产品",
    all: "全部产品",
    allCount: (count: number) => `全部 ${count} 个`,
    specs: "规格",
    related: "相关研究",
    talk: "找我们聊聊",
    updated: "更新于",
    minutes: (count: number) => `约 ${count} 分钟`,
    empty: "还没有产品。",
    missing: "没有这个产品。",
    missingHint: "链接可能写错了，或者这个产品已经并进了别处。从产品目录重新找。",
  },
  en: {
    section: "Products",
    others: "Also from us",
    all: "All products",
    allCount: (count: number) => `All ${count}`,
    specs: "Specs",
    related: "Related research",
    talk: "Talk to us",
    updated: "Updated",
    minutes: (count: number) => `${count} min read`,
    empty: "No products yet.",
    missing: "No such product.",
    missingHint: "The link may be wrong, or the product was folded into another one. Start again from the catalogue.",
  },
} as const;

const copy = (language: Language) => COPY[language];

const arrow = (glyph: string) => `<span aria-hidden="true">${glyph}</span>`;

function button(href: string, label: string, kind: "primary" | "secondary"): string {
  return `<a class="button ${kind}" href="${escapeHtml(href)}"><span>${escapeHtml(
    label,
  )}</span>${arrow(kind === "primary" ? "↗" : "→")}</a>`;
}

/** The repository link is the action; everything else is a footnote. */
export function primaryLink(product: ProductSummary): ProductLink | undefined {
  return product.links.find((link) => link.kind === "repo") ?? product.links[0];
}

function statusLine(
  product: ProductSummary,
  catalog: Catalog | undefined,
  language: Language,
  className: string,
): string {
  const notice = product.notice ? pick(product.notice, language) : "";
  return `<p class="${className}"><span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(
    stageLine(product, language, catalog),
  )}</span>${
    notice ? `<span class="product-status-note">${escapeHtml(notice)}</span>` : ""
  }</p>`;
}

function highlightList(
  product: ProductSummary,
  language: Language,
  limit: number,
  className: string,
): string {
  const items = product.highlights.slice(0, limit);
  if (!items.length) return "";
  return `<dl class="${className}">${items
    .map(
      (item) =>
        `<div><dt>${escapeHtml(pick(item.title, language))}</dt><dd>${escapeHtml(
          pick(item.text, language),
        )}</dd></div>`,
    )
    .join("")}</dl>`;
}

function featureButtons(product: ProductSummary, language: Language): string {
  const repo = primaryLink(product);
  return `<div class="product-actions">${
    repo ? button(repo.href, pick(repo.label, language), "primary") : ""
  }${button(aboutUrl(language), copy(language).talk, "secondary")}</div>`;
}

/** The deck's About panel. It is a panel, not a page, so the language rides in the query. */
const aboutUrl = (language: Language) => (language === "en" ? "/?lang=en#about" : "/#about");

/* ---------- the deck panel ---------- */

const DECK_HIGHLIGHTS = 4;

export function renderProductPanel(index: ProductIndex, language: Language): string {
  const text = copy(language);
  const catalog = index.catalog;
  const products = index.products ?? [];
  if (!products.length) {
    return `<p class="product-empty">${escapeHtml(text.empty)}</p>`;
  }

  const [featured, ...rest] = products;
  const link = productUrl(featured.id, language);

  const restBlock = rest.length
    ? `<div class="product-rest">
        <p class="product-rest-label">${escapeHtml(text.others)}</p>
        <ul class="product-rest-list">${rest
          .map(
            (product) => `<li><a class="product-rest-item" href="${productUrl(
              product.id,
              language,
            )}">
              <span class="product-rest-name">${escapeHtml(product.name)}</span>
              <span class="product-rest-tagline">${escapeHtml(
                pick(product.tagline, language),
              )}</span>
              <span class="product-rest-meta">${escapeHtml(
                facets(product, language, catalog),
              )}</span>
            </a></li>`,
          )
          .join("")}</ul>
        <a class="product-all" href="${catalogUrl({}, language)}">${escapeHtml(
          text.all,
        )}${arrow("→")}</a>
      </div>`
    : "";

  return `<div class="product-feature" data-product="${escapeHtml(featured.id)}">
      <h2 id="product-title"><a href="${link}">${escapeHtml(featured.name)}</a></h2>
      <p class="lead">${escapeHtml(pick(featured.summary, language))}</p>
      ${statusLine(featured, catalog, language, "status-line")}
      ${highlightList(featured, language, DECK_HIGHLIGHTS, "features")}
      ${featureButtons(featured, language)}
    </div>${restBlock}`;
}

/* ---------- the catalogue ---------- */

export function renderProductCard(
  product: ProductSummary,
  catalog: Catalog | undefined,
  language: Language,
): string {
  const meta = [nameFor(catalog, "categories", product.category, language)];
  if (product.version) meta.push(`v${product.version}`);
  return `<a class="product-card" href="${productUrl(
    product.id,
    language,
  )}" data-product="${escapeHtml(product.id)}" data-stage="${escapeHtml(product.stage)}">
      <span class="product-card-top">
        <span class="product-card-name">${escapeHtml(product.name)}</span>
        <span class="product-card-stage">${escapeHtml(
          nameFor(catalog, "stages", product.stage, language),
        )}</span>
      </span>
      <span class="product-card-tagline">${escapeHtml(pick(product.tagline, language))}</span>
      <span class="product-card-meta">${escapeHtml(meta.join(" · "))}</span>
    </a>`;
}

/* ---------- one product ---------- */

export interface RelatedTopic {
  id: string;
  title: string;
}

export function renderProductDetail(
  product: ProductDetail,
  catalog: Catalog | undefined,
  related: RelatedTopic[],
  language: Language,
): string {
  const text = copy(language);
  const repo = primaryLink(product);
  const others = product.links.filter((link) => link !== repo);

  const actions = `<div class="product-actions">${
    repo ? button(repo.href, pick(repo.label, language), "primary") : ""
  }${others
    .map((link) => button(link.href, pick(link.label, language), "secondary"))
    .join("")}${button(aboutUrl(language), text.talk, "secondary")}</div>`;

  const facts = product.facts.length
    ? `<section class="article-section product-facts">
        <h2>${escapeHtml(text.specs)}</h2>
        <dl class="product-fact-list">${product.facts
          .map(
            (fact) =>
              `<div><dt>${escapeHtml(pick(fact.label, language))}</dt><dd>${escapeHtml(
                pick(fact.value, language),
              )}</dd></div>`,
          )
          .join("")}</dl>
      </section>`
    : "";

  const research = related.length
    ? `<section class="article-section product-related">
        <h2>${escapeHtml(text.related)}</h2>
        <ul>${related
          .map(
            (topic) =>
              `<li><a href="research.html?id=${encodeURIComponent(topic.id)}${
                language === "en" ? "&lang=en" : ""
              }">${escapeHtml(topic.title)}</a></li>`,
          )
          .join("")}</ul>
      </section>`
    : "";

  const note = language === "en" ? product.notes.en || product.notes.zh : product.notes.zh;

  return `<article class="product-page" data-product="${escapeHtml(product.id)}">
      <p class="article-kicker">${escapeHtml(facets(product, language, catalog))}</p>
      <h1>${escapeHtml(product.name)}</h1>
      <p class="article-lead">${escapeHtml(pick(product.tagline, language))}</p>
      <p class="product-summary">${escapeHtml(pick(product.summary, language))}</p>
      ${statusLine(product, catalog, language, "product-status")}
      <p class="article-meta">${escapeHtml(text.updated)} ${escapeHtml(
        product.updated,
      )} · ${escapeHtml(text.minutes(product.minutes))}</p>
      ${actions}
      <section class="article-section product-highlights-section">
        ${highlightList(product, language, 6, "product-highlights")}
      </section>
      ${facts}
      <div class="article-text">${renderMarkdown(note, { dropFirstHeading: true })}</div>
      ${research}
      <nav class="product-back"><a href="${catalogUrl({}, language)}">← ${escapeHtml(
        text.all,
      )}</a></nav>
    </article>`;
}

/* ---------- the catalogue page ---------- */

export interface CatalogView {
  index: ProductIndex;
  language: Language;
  category: string | null;
}

export function renderCatalogHeader(view: CatalogView): string {
  const { index, language } = view;
  const text = copy(language);
  const products = index.products ?? [];
  // Only offer a filter when there is something to separate. With one category
  // a chip row is furniture that does nothing.
  const categories = (index.catalog?.categories ?? []).filter((entry) =>
    products.some((product) => product.category === entry.id),
  );

  const title = language === "en" ? "Everything we build." : "我们做的东西。";
  const lead =
    language === "en"
      ? `${products.length} product${products.length === 1 ? "" : "s"}. Each one says what it does and how far it has got.`
      : `${products.length} 个产品。每个都写清楚它是做什么的、做到哪一步了。`;

  const chips = [null, ...categories.map((entry) => entry.id)].map((id) => {
    const label = id
      ? pick(categories.find((entry) => entry.id === id)!, language)
      : text.all;
    const count = id
      ? products.filter((product) => product.category === id).length
      : products.length;
    return `<button type="button" class="library-chip" data-category="${
      id ?? ""
    }" aria-pressed="false"><span>${escapeHtml(label)}</span><span class="library-chip-count">${count}</span></button>`;
  });

  return `<p class="article-kicker">${escapeHtml(text.section)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="article-lead">${escapeHtml(lead)}</p>
    ${
      categories.length > 1
        ? `<div class="library-filters product-filters" role="group" aria-label="${escapeHtml(
            text.all,
          )}">${chips.join("")}</div>`
        : ""
    }`;
}

export function renderCatalogGrid(view: CatalogView): string {
  const { index, language, category } = view;
  const catalog = index.catalog;
  const products = index.products.filter(
    (product) => !category || product.category === category,
  );
  if (!products.length) {
    return `<p class="product-empty">${escapeHtml(copy(language).empty)}</p>`;
  }
  return `<div class="product-grid">${products
    .map((product) => renderProductCard(product, catalog, language))
    .join("")}</div>`;
}

export function renderMissing(language: Language): string {
  const text = copy(language);
  return `<div class="article-missing">
      <h1>${escapeHtml(text.missing)}</h1>
      <p>${escapeHtml(text.missingHint)}</p>
      <a class="article-back" href="${catalogUrl({}, language)}">${escapeHtml(
        text.all,
      )}</a>
    </div>`;
}
