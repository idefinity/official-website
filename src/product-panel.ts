/**
 * The product panel on the deck.
 *
 * The block is already in the HTML — `vite.config.ts` renders it at build time
 * from the same index — so this only has to repaint it when the language
 * changes. That ordering matters: with JavaScript off, or with the fetch
 * failing, the panel still shows a real product instead of an empty heading.
 */
import { currentLanguage, loadProductIndex, type ProductIndex } from "./product.ts";
import { renderProductPanel } from "./product-markup.ts";

let root: HTMLElement | null = null;
let index: ProductIndex | null = null;

export async function mountProductPanel(element: HTMLElement) {
  root = element;
  try {
    index = await loadProductIndex();
    paint();
  } catch {
    // Keep the build-time block exactly as it came down the wire.
    element.dataset.productPanel = "fallback";
  }
}

/** Called when the language switches; the panel carries both languages in the index. */
export function refreshProductPanel() {
  if (root && index) paint();
}

function paint() {
  if (!root || !index) return;
  root.innerHTML = renderProductPanel(index, currentLanguage());
  root.dataset.productPanel = "loaded";
  root.dataset.count = String(index.products.length);
}
