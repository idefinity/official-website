import "./style.css";
import { setupLanguage } from "./i18n";
import { refreshNavMenus, setupNavMenus } from "./nav-menu";
import { mountProductPanel, refreshProductPanel } from "./product-panel";
import { mountResearchNotes, refreshResearchNotes } from "./research";
import {
  FRAMES,
  LOOP_HALF_WIDTH,
  STILL_ASPECT,
  STILL_FRAME,
  focusAt,
} from "./scene/frames";
import type { SceneController, SceneSection } from "./scene/scene";

document.documentElement.classList.add("js");

const deck = document.querySelector<HTMLElement>("#main")!;
const panels = [...deck.querySelectorAll<HTMLElement>(".panel")];
const sceneHost = document.querySelector<HTMLElement>("#scene-host")!;
const figure = document.querySelector<HTMLElement>(".figure")!;
const still = document.querySelector<HTMLImageElement>("#figure-still")!;
const progressBar = document.querySelector<HTMLElement>("#progress-bar")!;
const navigation = document.querySelector<HTMLElement>("#navigation")!;
const menu = document.querySelector<HTMLButtonElement>("#menu")!;
const navLinks = [
  ...navigation.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
];
const wide = matchMedia("(min-width: 901px)");

let controller: SceneController | undefined;
let section: SceneSection | undefined;
// Where the deck is, in panels. 1.4 means 40% of the way from panel 2 to 3.
let progress = 0;
let frame = 0;

/**
 * A phone that opens `/#product` gets a vertical document, and the panel it
 * asked for has to end up at the top. The panels above it keep changing height
 * for a second or two — the ledger swaps three static cards for the live ones,
 * the figure gets its canvas — so one exact jump at load is not enough. Keep
 * re-aligning until the reader takes over.
 */
let anchored = -1;
function snapAnchor() {
  if (anchored < 0 || wide.matches) return;
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  // `scroll-behavior: smooth` would let the browser's own fragment jump and
  // ours run at once, and the loser stops a few dozen pixels short.
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, panels[anchored].offsetTop);
  root.style.scrollBehavior = previous;
}
for (const type of ["wheel", "touchstart", "keydown"] as const) {
  window.addEventListener(type, () => (anchored = -1), { passive: true, once: true });
}

// The cards carry both languages inline, so a language switch just repaints
// them; the static copy in the HTML is only there for the no-JS path.
setupLanguage(() => {
  refreshResearchNotes();
  refreshNavMenus();
  refreshProductPanel();
});

const researchNotes = document.querySelector<HTMLElement>("#research .notes");
if (researchNotes) void mountResearchNotes(researchNotes).then(snapAnchor);

const productPanel = document.querySelector<HTMLElement>("[data-product-panel]");
if (productPanel) void mountProductPanel(productPanel).then(snapAnchor);

/* ---------- menu ---------- */

menu.hidden = false;
function closeMenu() {
  navigation.dataset.open = "false";
  menu.setAttribute("aria-expanded", "false");
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  navigation.dataset.open = String(open);
  menu.setAttribute("aria-expanded", String(open));
});
navigation.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("a")) closeMenu();
});
document.addEventListener("click", (event) => {
  if (menu.getAttribute("aria-expanded") !== "true") return;
  const target = event.target as Node;
  if (!navigation.contains(target) && !menu.contains(target)) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
  }
});

setupNavMenus();

/* ---------- the figure ---------- */

// The figure owns the still image, so mirror the scene's state onto it and let
// CSS decide whether the still or the live canvas is visible.
function mirrorSceneState() {
  figure.dataset.renderer = sceneHost.dataset.renderer ?? "pending";
  figure.dataset.canvasReady = sceneHost.dataset.canvasReady ?? "false";
  // Also on the root, so copy elsewhere on the page can tell a still figure
  // from a live one.
  document.documentElement.dataset.renderer = figure.dataset.renderer;
}
mirrorSceneState();
new MutationObserver(mirrorSceneState).observe(sceneHost, {
  attributes: true,
  attributeFilter: ["data-renderer", "data-canvas-ready"],
});

/**
 * The still is one captured frame of the same scene. Scale and shift it so it
 * keeps roughly the same crop as the live render — otherwise the no-JS and
 * no-WebGL paths would drop the one idea the layout is built on.
 */
function panStill(value: number) {
  const base = FRAMES[STILL_FRAME];
  const frame = focusAt(value);
  const scale = base.zoom / frame.zoom;
  const width = LOOP_HALF_WIDTH * 2 * base.zoom;
  const height = width / STILL_ASPECT;
  const u = 0.5 + (frame.x - base.x) / width;
  const v = 0.5 - (frame.y - base.y) / height;
  // A single shot cannot reach past its own edges. Clamp the shift to the
  // margin the scale opens up, so the still always covers the frame and only
  // the outer panels lose their exact crop.
  const limit = Math.max(0, (scale - 1) / (2 * scale));
  const clamp = (offset: number) => Math.max(-limit, Math.min(limit, offset));
  const x = clamp(-(u - 0.5)) * 100;
  const y = clamp(-(v - 0.5)) * 100;
  still.style.transform = `scale(${scale.toFixed(4)}) translate(${x.toFixed(3)}%, ${y.toFixed(3)}%)`;
}

/* ---------- deck ---------- */

function applyProgress(value: number) {
  const index = Math.max(0, Math.min(panels.length - 1, Math.round(value)));
  document.body.dataset.panel = String(index);
  for (const link of navLinks) {
    const id = link.getAttribute("href")!.slice(1);
    link.setAttribute("aria-current", String(id === panels[index].id));
  }
  const ratio = value / Math.max(1, panels.length - 1);
  progressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio)).toFixed(4)})`;
  controller?.setProgress(value);
  const next = (panels[index].dataset.sceneSection as SceneSection) ?? "hero";
  if (next !== section) {
    section = next;
    controller?.setSection(next);
  }
  panStill(value);
}

function goTo(index: number, smooth = true) {
  const target = Math.max(0, Math.min(panels.length - 1, index));
  if (!wide.matches) {
    panels[target].scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
    return;
  }
  if (!smooth) {
    stop();
    progress = target;
    paint();
    return;
  }
  // Slide it ourselves. Native smooth scrolling is cancelled outright by a
  // scroll-snap container, and a hard cut loses the one gesture the layout is
  // built around. A longer jump gets a longer slide, capped so Home does not
  // take a second and a half.
  const distance = Math.abs(target - progress);
  controller?.pageTurn();
  animateTo(target, 380 + Math.min(360, distance * 170));
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
}

function paint() {
  deck.style.transform = wide.matches
    ? `translate3d(${(-progress * 100).toFixed(4)}%, 0, 0)`
    : "";
  applyProgress(progress);
}

function animateTo(value: number, duration: number) {
  stop();
  const from = progress;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    progress = from + (value - from) * eased;
    paint();
    if (t < 1) {
      frame = requestAnimationFrame(step);
    } else {
      progress = value;
      paint();
      frame = 0;
    }
  };
  frame = requestAnimationFrame(step);
}

// A tablet in landscape gets the deck but no scroll wheel, so the track takes
// a drag the way a carousel would.
let drag: { x: number; from: number; moved: boolean } | null = null;
deck.addEventListener("pointerdown", (event) => {
  if (!wide.matches || event.pointerType === "mouse") return;
  stop();
  drag = { x: event.clientX, from: progress, moved: false };
});
window.addEventListener(
  "pointermove",
  (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    progress = Math.max(
      0,
      Math.min(panels.length - 1, drag.from - dx / (window.innerWidth || 1)),
    );
    paint();
  },
  { passive: true },
);
window.addEventListener("pointerup", () => {
  if (!drag) return;
  const travel = progress - drag.from;
  const settle =
    Math.round(progress) +
    (drag.moved && Math.abs(travel - Math.round(travel)) > 0.12
      ? Math.sign(travel)
      : 0);
  drag = null;
  goTo(settle);
});

// Phone: the deck is an ordinary vertical page, so the panel is whichever one
// owns the middle of the viewport.
function onPageScroll() {
  if (wide.matches) return;
  const middle = window.scrollY + window.innerHeight * 0.5;
  let index = 0;
  panels.forEach((panel, position) => {
    if (panel.offsetTop <= middle) index = position;
  });
  progress = index;
  applyProgress(index);
}
window.addEventListener("scroll", onPageScroll, { passive: true });

// A vertical wheel over a horizontal deck is the one gesture that needs
// translating. Listen on the window: the header is fixed above the deck, and a
// pointer parked there should still turn the page. Trackpads that already send
// deltaX are left alone.
let wheelTotal = 0;
let wheelUntil = 0;
window.addEventListener(
  "wheel",
  (event) => {
    if (!wide.matches) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    // A panel that scrolls inside itself keeps its own wheel. The ledger is
    // already longer than the viewport, and turning the page mid-read is not
    // what someone scrolling that list asked for.
    const scroller =
      event.target instanceof Element
        ? event.target.closest("[data-panel-scroll]")
        : null;
    if (scroller instanceof HTMLElement && scroller.scrollHeight > scroller.clientHeight + 1) {
      const atTop = scroller.scrollTop <= 0;
      const atEnd =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if (!(event.deltaY < 0 ? atTop : atEnd)) return;
    }
    event.preventDefault();
    const now = performance.now();
    if (now < wheelUntil) {
      wheelTotal = 0;
      return;
    }
    const step =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * 400
          : event.deltaY;
    wheelTotal += step;
    if (Math.abs(wheelTotal) < 36) return;
    const direction = wheelTotal > 0 ? 1 : -1;
    wheelTotal = 0;
    wheelUntil = now + 700;
    goTo(Math.round(progress) + direction);
  },
  { passive: false },
);

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // A key event aimed at the document itself has no element to test, and
  // `closest` would throw on it.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select")) return;
  const index = Math.round(progress);
  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
      goTo(index + 1);
      break;
    case "ArrowDown":
      if (!wide.matches) return;
      goTo(index + 1);
      break;
    case "ArrowLeft":
    case "PageUp":
      goTo(index - 1);
      break;
    case "ArrowUp":
      if (!wide.matches) return;
      goTo(index - 1);
      break;
    case "Home":
      goTo(0);
      break;
    case "End":
      goTo(panels.length - 1);
      break;
    default:
      return;
  }
  event.preventDefault();
});

document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute("href")!.slice(1);
  const index = panels.findIndex((panel) => panel.id === id);
  if (index < 0) return;
  event.preventDefault();
  closeMenu();
  goTo(index);
  history.replaceState(null, "", `#${id}`);
});

wide.addEventListener("change", () => {
  goTo(Math.round(progress), false);
});

/* ---------- scene ---------- */

function fallback() {
  controller = undefined;
  section = undefined;
  sceneHost.dataset.renderer = "static";
  sceneHost.dataset.canvasReady = "false";
}

let pageActive = true;
let initialization = 0;
async function mountScene() {
  const generation = ++initialization;
  try {
    const { createScene } = await import("./scene/scene");
    if (!pageActive || generation !== initialization) return;
    controller = createScene(sceneHost, fallback);
    section = undefined;
    paint();
    // The canvas replaces the still in a fixed band; on a phone that can move
    // every panel below it.
    snapAnchor();
  } catch {
    fallback();
  }
}
void mountScene();

window.addEventListener("pagehide", () => {
  pageActive = false;
  controller?.dispose();
  controller = undefined;
  section = undefined;
  sceneHost.dataset.renderer = "static";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    pageActive = true;
    void mountScene();
  }
});
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pageActive = false;
    controller?.dispose();
  });
}

/* ---------- start ---------- */

// A same-document jump to #research changes the URL without reloading, and the
// default fragment navigation has nothing to scroll. Follow it by hand.
window.addEventListener("hashchange", () => {
  const index = panels.findIndex((panel) => `#${panel.id}` === location.hash);
  if (index >= 0) goTo(index);
});

const start = Math.max(
  0,
  panels.findIndex((panel) => `#${panel.id}` === location.hash),
);
progress = start;
paint();
if (start > 0 && !wide.matches) {
  anchored = start;
  snapAnchor();
}
