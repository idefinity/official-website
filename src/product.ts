/**
 * The reading half of the product catalogue.
 *
 * `product/index.json` is written by `scripts/product.mjs` at build time: one
 * entry per product, no body text, plus the vocabulary the catalogue uses.
 * The deck, the header menu and the catalogue page read that; a product page
 * reads one payload, so a single product costs one small request.
 *
 * A failed fetch is not fatal anywhere. The homepage panel is rendered at build
 * time, so what a reader sees when this throws is still a real product block.
 */
import type {
  Language,
  ProductDetail,
  ProductIndex,
} from "./product-types.ts";

export type { Language, ProductDetail, ProductIndex };

const base = () => import.meta.env.BASE_URL;

export const currentLanguage = (): Language =>
  document.documentElement.lang === "en" ? "en" : "zh";

export function readProductIndex(): Promise<ProductIndex> {
  return fetch(`${base()}product/index.json`, {
    headers: { accept: "application/json" },
  }).then((response) => {
    if (!response.ok) throw new Error(`product index ${response.status}`);
    return response.json() as Promise<ProductIndex>;
  });
}

/**
 * One fetch per page load, shared by the panel, the menu and the catalogue.
 * A failed attempt is forgotten so the next hover can try again.
 */
let indexRequest: Promise<ProductIndex> | null = null;
export function loadProductIndex(): Promise<ProductIndex> {
  indexRequest ??= readProductIndex().catch((error) => {
    indexRequest = null;
    throw error;
  });
  return indexRequest;
}

export function readProduct(id: string): Promise<ProductDetail> {
  return fetch(`${base()}product/items/${encodeURIComponent(id)}.json`, {
    headers: { accept: "application/json" },
  }).then((response) => {
    if (!response.ok) throw new Error(`product ${response.status}`);
    return response.json() as Promise<ProductDetail>;
  });
}
