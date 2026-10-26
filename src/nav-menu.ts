/**
 * The two menus in the header: research and products.
 *
 * Both are filled from their index, so adding a topic or a product adds a row
 * here without anyone touching the markup. Each one is a shortcut, not the
 * shelf: the last row always goes to the full list.
 *
 * Hover is the obvious gesture on a mouse, and it is the only one that needs
 * code — focus and click already work through the markup, because each menu is
 * a disclosure. On a touch screen there is no hover, so the menu stays shut and
 * the "all" link in the nav does the job.
 */
import {
  facets as researchFacets,
  libraryUrl,
  loadIndex,
  topicUrl,
  type ResearchIndex,
} from "./research.ts";
import { loadProductIndex, type ProductIndex } from "./product.ts";
import { facets as productFacets, pick, type Language } from "./product-types.ts";

type Kind = "research" | "product";

const REPO = "https://github.com/ziangziangziang/graphfin";

const COPY = {
  research: {
    zh: { label: "最近", browse: "按方向", all: "全部", fail: "台账没读出来。", failLink: "去仓库看" },
    en: { label: "Latest", browse: "By direction", all: "All", fail: "The ledger did not load.", failLink: "Open the repository" },
  },
  product: {
    zh: { label: "产品", browse: "按类型", all: "目录", fail: "产品清单没读出来。", failLink: "去仓库看" },
    en: { label: "Products", browse: "By kind", all: "Catalogue", fail: "The catalogue did not load.", failLink: "Open the repository" },
  },
} as const;

const element = (tag: string, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const anchor = (className: string, href: string, text = ""): HTMLAnchorElement => {
  const node = document.createElement("a");
  node.className = className;
  node.href = href;
  if (text) node.textContent = text;
  return node;
};

const language = (): Language =>
  document.documentElement.lang === "en" ? "en" : "zh";

const kindOf = (menu: HTMLElement): Kind =>
  menu.closest<HTMLElement>("[data-nav-item]")?.dataset.navKind === "product"
    ? "product"
    : "research";

/** One entry per painted menu, so a language switch can repaint without refetching. */
const painted = new Map<HTMLElement, { kind: Kind; index: ResearchIndex | ProductIndex }>();

/** Loads on first hover, then reuses the parsed index for every repaint. */
export async function hydrateNavMenu(menu: HTMLElement) {
  const kind = kindOf(menu);
  try {
    if (kind === "product") {
      const index = await loadProductIndex();
      paintProducts(menu, index);
      painted.set(menu, { kind, index });
    } else {
      const index = await loadIndex();
      paintResearch(menu, index);
      painted.set(menu, { kind, index });
    }
  } catch {
    paintFailure(menu, kind);
  }
}

/** Called when the language switches; both menus carry both languages. */
export function refreshNavMenus() {
  for (const [menu, state] of painted) {
    if (state.kind === "product") paintProducts(menu, state.index as ProductIndex);
    else paintResearch(menu, state.index as ResearchIndex);
  }
}

/* ---------- research ---------- */

function paintResearch(menu: HTMLElement, index: ResearchIndex) {
  const text = COPY.research[language()];
  const taxonomy = index.taxonomy;
  const recent = index.topics.slice(0, 4);
  const count = (id: string) =>
    index.counts?.byTrack?.[id] ?? index.topics.filter((topic) => topic.track === id).length;
  const tracks = (taxonomy?.tracks ?? [])
    .map((entry) => ({ ...entry, count: count(entry.id) }))
    .filter((entry) => entry.count > 0);

  const fragment = document.createDocumentFragment();

  const head = element("div", "nav-menu-head");
  head.append(element("span", "nav-menu-label", text.label));
  head.append(
    anchor("nav-menu-all", libraryUrl({}, language()), `${text.all} · ${index.topics.length}`),
  );
  fragment.append(head);

  const list = element("ul", "nav-menu-list");
  for (const topic of recent) {
    const item = element("li");
    const link = anchor("nav-menu-entry", topicUrl(topic.id, language()));
    link.append(element("span", "nav-menu-title", pick(topic.title, language())));
    link.append(element("span", "nav-menu-facet", researchFacets(topic, language(), taxonomy)));
    item.append(link);
    list.append(item);
  }
  fragment.append(list);

  if (tracks.length) {
    fragment.append(element("div", "nav-menu-rule"));
    const label = element("div", "nav-menu-head");
    label.append(element("span", "nav-menu-label", text.browse));
    fragment.append(label);

    const shelf = element("ul", "nav-menu-tracks");
    for (const track of tracks) {
      const item = element("li");
      const link = anchor("nav-menu-track", libraryUrl({ track: track.id }, language()));
      link.append(element("span", "", pick(track, language())));
      link.append(element("span", "nav-menu-count", String(track.count)));
      item.append(link);
      shelf.append(item);
    }
    fragment.append(shelf);
  }

  menu.replaceChildren(fragment);
  menu.dataset.state = "loaded";
  menu.dataset.kind = "research";
}

/* ---------- products ---------- */

const MENU_PRODUCTS = 5;

function paintProducts(menu: HTMLElement, index: ProductIndex) {
  const text = COPY.product[language()];
  const catalog = index.catalog;
  const products = index.products ?? [];
  const categories = (catalog?.categories ?? [])
    .map((entry) => ({
      ...entry,
      count: products.filter((product) => product.category === entry.id).length,
    }))
    .filter((entry) => entry.count > 0);

  const fragment = document.createDocumentFragment();

  const head = element("div", "nav-menu-head");
  head.append(element("span", "nav-menu-label", text.label));
  head.append(
    anchor("nav-menu-all", catalogUrlFor(null), `${text.all} · ${products.length}`),
  );
  fragment.append(head);

  const list = element("ul", "nav-menu-list");
  for (const product of products.slice(0, MENU_PRODUCTS)) {
    const item = element("li");
    const link = anchor("nav-menu-entry", productUrlFor(product.id));
    link.append(element("span", "nav-menu-title", product.name));
    link.append(element("span", "nav-menu-facet", productFacets(product, language(), catalog)));
    item.append(link);
    list.append(item);
  }
  fragment.append(list);

  // A category row is only worth a row when it splits the list. One category is
  // the whole list, and it already has a link.
  if (categories.length > 1) {
    fragment.append(element("div", "nav-menu-rule"));
    const label = element("div", "nav-menu-head");
    label.append(element("span", "nav-menu-label", text.browse));
    fragment.append(label);

    const shelf = element("ul", "nav-menu-tracks");
    for (const category of categories) {
      const item = element("li");
      const link = anchor("nav-menu-track", catalogUrlFor(category.id));
      link.append(element("span", "", pick(category, language())));
      link.append(element("span", "nav-menu-count", String(category.count)));
      item.append(link);
      shelf.append(item);
    }
    fragment.append(shelf);
  }

  menu.replaceChildren(fragment);
  menu.dataset.state = "loaded";
  menu.dataset.kind = "product";
}

function productUrlFor(id: string) {
  return `product.html?id=${encodeURIComponent(id)}${language() === "en" ? "&lang=en" : ""}`;
}

function catalogUrlFor(category: string | null) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (language() === "en") params.set("lang", "en");
  const query = params.toString();
  return `product.html${query ? `?${query}` : ""}`;
}

/* ---------- failure ---------- */

function paintFailure(menu: HTMLElement, kind: Kind) {
  const text = COPY[kind][language()];
  const wrap = element("div", "nav-menu-fail");
  wrap.append(element("p", "", text.fail));
  const link = anchor("nav-menu-all", REPO, `${text.failLink} ↗`);
  link.target = "_blank";
  link.rel = "noreferrer";
  wrap.append(link);
  menu.replaceChildren(wrap);
  menu.dataset.state = "failed";
}

/* ---------- opening and closing ---------- */

type Disclosure = {
  item: HTMLElement;
  trigger: HTMLAnchorElement;
  menu: HTMLElement;
  setOpen: (value: boolean) => void;
};

/**
 * Wires hover, focus and Escape for every `[data-nav-item]`. Click and focus
 * already work through the markup; hover is the only part that needs code.
 */
export function setupNavMenus() {
  const wide = matchMedia("(min-width: 901px)");
  const canHover = matchMedia("(hover: hover) and (pointer: fine)");
  const hoverable = () => wide.matches && canHover.matches;

  const disclosures: Disclosure[] = [];

  for (const item of document.querySelectorAll<HTMLElement>("[data-nav-item]")) {
    const trigger = item.querySelector<HTMLAnchorElement>("a");
    const menu = item.querySelector<HTMLElement>("[data-nav-menu]");
    if (!trigger || !menu) continue;

    let requested = false;
    let closeTimer = 0;
    // Escape puts focus back on the trigger, and focusing a disclosure opens it
    // again. The flag is only true across that one synchronous `focus()` call.
    let restoringFocus = false;

    const setOpen = (value: boolean) => {
      item.dataset.open = String(value);
      trigger.setAttribute("aria-expanded", String(value));
    };

    const request = () => {
      if (requested) return;
      requested = true;
      void hydrateNavMenu(menu);
    };

    item.addEventListener("pointerenter", (event) => {
      if (!hoverable() || event.pointerType === "touch") return;
      window.clearTimeout(closeTimer);
      // Only one menu at a time: two open panels overlap on a narrow window.
      for (const other of disclosures) if (other.item !== item) other.setOpen(false);
      request();
      setOpen(true);
    });

    item.addEventListener("pointerleave", () => {
      if (!hoverable()) return;
      window.clearTimeout(closeTimer);
      // A short grace period: the pointer crosses the gap under the trigger on
      // most diagonals. Keyboard focus keeps it open — the mouse moving away is
      // not a reason to hide the thing a keyboard user is standing in.
      closeTimer = window.setTimeout(() => {
        if (!item.contains(document.activeElement)) setOpen(false);
      }, 140);
    });

    item.addEventListener("focusin", () => {
      if (restoringFocus || !hoverable()) return;
      request();
      setOpen(true);
    });

    item.addEventListener("focusout", (event) => {
      if (!item.contains(event.relatedTarget as Node)) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || item.dataset.open !== "true") return;
      event.preventDefault();
      setOpen(false);
      restoringFocus = true;
      trigger.focus();
      restoringFocus = false;
    });

    menu.addEventListener("click", (event) => {
      if ((event.target as Element).closest("a")) setOpen(false);
    });
    trigger.addEventListener("click", () => setOpen(false));

    disclosures.push({ item, trigger, menu, setOpen });
  }
}
