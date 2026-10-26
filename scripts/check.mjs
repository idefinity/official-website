/**
 * A short health check for the built site. Not a unit-test framework — just the
 * handful of things that quietly break a horizontal deck like this: panel
 * navigation, the lens following the panels, language switching, the static
 * fallbacks, and overflow.
 *
 *   npm run build && npm run preview &
 *   node scripts/check.mjs
 */
import { chromium } from "playwright";

const base = process.env.CHECK_URL || "http://127.0.0.1:4180/";
const browser = await chromium.launch();
const failures = [];
let checks = 0;

function expect(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

async function overflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function panel(page) {
  return page.evaluate(() => document.body.dataset.panel);
}

async function shift(page) {
  return page.evaluate(() => {
    const match = /translate3d\((-?[\d.]+)%/.exec(
      document.querySelector("#main").style.transform,
    );
    return match ? Math.round(Number(match[1])) : 0;
  });
}

// 1. Desktop: the page renders, the scene mounts, nothing overflows.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#scene-host[data-canvas-ready="true"]', {
    timeout: 40000,
  });
  expect(errors.length === 0, `console errors: ${errors.join(" | ")}`);
  expect(
    (await page.getAttribute("#scene-host", "data-renderer")) === "webgl",
    "desktop renderer should be webgl",
  );
  expect((await overflow(page)) === 0, "desktop page overflows horizontally");
  for (const id of ["top", "research", "product", "about"]) {
    expect((await page.$(`#${id}`)) !== null, `missing panel #${id}`);
  }
  expect(
    (await page.textContent("h1"))?.includes("让关系"),
    "Chinese headline missing by default",
  );
  const icp = await page.textContent(".footer-meta a");
  expect(icp?.trim() === "粤ICP备2026161143号-1", `footer ICP wrong: ${icp}`);
  expect((await panel(page)) === "0", "should start on the first panel");
  const lattice = await page.getAttribute("#scene-host", "data-lattice");
  const [nodeCount, bondCount] = (lattice ?? "").split(":").map(Number);
  expect(nodeCount > 0, `lattice counts missing: ${lattice}`);
  expect(
    bondCount === nodeCount * 1.5,
    `lattice has unconnected atoms: ${lattice} bonds for ${nodeCount} nodes`,
  );
  await page.close();
}

// 2. The deck moves: keyboard, wheel, links, and the hash.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1400);
  expect((await panel(page)) === "1", `ArrowRight left us on ${await panel(page)}`);
  expect((await shift(page)) === -100, `ArrowRight shifted ${await shift(page)}%`);
  expect(
    (await page.getAttribute('nav a[href="#research"]', "aria-current")) === "true",
    "nav should mark the current panel",
  );
  // A deck that clips itself loses the panel it just moved to; the copy has to
  // actually be inside the viewport, not merely in the DOM.
  const heading = await page.evaluate(() => {
    const box = document.querySelector("#research h2").getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right) };
  });
  expect(
    heading.left >= 0 && heading.right <= 1440 && heading.right > heading.left,
    `research heading is off-screen: ${JSON.stringify(heading)}`,
  );

  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(1400);
  expect((await panel(page)) === "2", `wheel left us on ${await panel(page)}`);

  await page.click('nav a[href="#about"]');
  await page.waitForTimeout(1500);
  // Read once: the second call inside the message can land mid-slide and
  // report a panel the assertion never saw.
  let at = await panel(page);
  expect(at === "3", `nav click left us on ${at}`);

  await page.keyboard.press("Home");
  await page.waitForTimeout(1400);
  at = await panel(page);
  expect(at === "0", `Home left us on ${at}`);

  // Ending a panel that was linked to directly: the lens has to follow.
  await page.goto(`${base}#product`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  at = await panel(page);
  expect(at === "2", `deep link left us on ${at}`);
  await page.close();
}

// 3. English by URL, and back to Chinese through the button.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}?lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  expect((await page.getAttribute("html", "lang")) === "en", "html lang should be en");
  expect(
    (await page.textContent("h1"))?.includes("Make connections"),
    "English headline missing with ?lang=en",
  );
  expect(
    (await page.textContent("nav a"))?.trim() === "Research",
    "English nav missing",
  );
  expect((await page.title()).includes("Ideafinity"), "English title missing");
  await page.click("#language");
  await page.waitForTimeout(300);
  expect(
    (await page.getAttribute("html", "lang")) === "zh-CN",
    "language button should return to zh-CN",
  );
  expect(
    (await page.textContent("h1"))?.includes("让关系"),
    "Chinese headline not restored",
  );
  expect(!page.url().includes("lang=en"), "URL should drop lang=en after switching");
  await page.close();
}

// 4. Mobile: a vertical document, no overflow, menu opens and closes.
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  expect((await overflow(page)) === 0, "mobile page overflows horizontally");
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(tall > 844 * 2, `mobile document should stack, height was ${tall}`);
  const figure = await page.evaluate(() => {
    const stage = document.querySelector(".stage").getBoundingClientRect();
    return { top: Math.round(stage.top), height: Math.round(stage.height) };
  });
  expect(
    figure.top > 300 && figure.height < 460,
    `mobile figure should sit in a band under the copy, got ${JSON.stringify(figure)}`,
  );
  expect(!(await page.isVisible("nav")), "mobile nav should start closed");
  await page.click("#menu");
  await page.waitForTimeout(300);
  expect(await page.isVisible("nav"), "mobile nav should open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(!(await page.isVisible("nav")), "Escape should close the mobile nav");
  await page.close();
}

// 5. Without JavaScript the Chinese page, the still image and a scrollable
//    document are all there.
{
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  expect(
    (await page.textContent("h1"))?.includes("让关系"),
    "no-JS: Chinese headline missing",
  );
  expect(
    await page.isVisible("img.figure-still"),
    "no-JS: fallback image should be visible",
  );
  expect(
    (await page.textContent(".footer-meta a"))?.trim() === "粤ICP备2026161143号-1",
    "no-JS: ICP missing",
  );
  const caption = await page.evaluate(() => {
    const still = document.querySelector(".cap-still");
    const live = document.querySelector(".cap-live");
    return {
      still: still ? getComputedStyle(still).display : "missing",
      live: live ? getComputedStyle(live).display : "missing",
    };
  });
  expect(
    caption.still !== "none" && caption.live === "none",
    `no-JS: caption should say still frame, got ${JSON.stringify(caption)}`,
  );
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(tall > 900 * 2, `no-JS: panels should stack vertically, height was ${tall}`);
  await context.close();
}

// 6. A failed renderer bundle leaves the still image in place.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/assets/scene-*.js", (route) => route.abort());
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  expect(
    (await page.getAttribute("#scene-host", "data-renderer")) === "static",
    "blocked scene should fall back to static",
  );
  const opacity = await page.evaluate(() => {
    const image = document.querySelector(".figure-still");
    return image ? getComputedStyle(image).opacity : "missing";
  });
  expect(opacity === "1", `fallback image opacity was ${opacity}`);
  // The caption must not keep claiming a live render over a captured frame.
  const caption = await page.evaluate(() => {
    const still = document.querySelector(".cap-still");
    const live = document.querySelector(".cap-live");
    return {
      still: still ? getComputedStyle(still).display : "missing",
      live: live ? getComputedStyle(live).display : "missing",
    };
  });
  expect(
    caption.still !== "none" && caption.live === "none",
    `static path should caption the still frame, got ${JSON.stringify(caption)}`,
  );
  await page.close();
}

// 7. The lattice crawls, and a page turn speeds it up. The scene writes two
//    numbers onto the host for this: where the pattern is, and how fast it runs.
{
  // The deck's own width, so a page turn moves the track directly instead of
  // going through native scrolling, which the scene only sees indirectly.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#scene-host[data-crawl]', { timeout: 40000 });
  await page.waitForTimeout(1200);

  const read = async () => ({
    phase: Number(await page.getAttribute("#scene-host", "data-crawl")),
    speed: Number(await page.getAttribute("#scene-host", "data-crawl-speed")),
  });

  const idle = await read();
  expect(idle.phase > 0.0002, `the pattern should be moving already, phase ${idle.phase}`);
  expect(
    idle.speed > 0.01 && idle.speed < 0.06,
    `idle crawl speed is out of range: ${idle.speed}`,
  );

  // Software rendering in CI runs this scene at a few frames a second, so the
  // phase moves in coarse steps. Wait for one instead of assuming a frame rate.
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    await page.waitForTimeout(150);
    const now = await read();
    const travel = (now.phase - idle.phase + 1) % 1;
    moved = travel > 0.0004;
  }
  expect(moved, "the pattern is not advancing along the loop");

  await page.keyboard.press("ArrowRight");
  // The turn announces itself; `setProgress` only sees one frame of the slide,
  // and a boost sized from one frame is no boost.
  expect(
    Number(await page.getAttribute("#scene-host", "data-turn")) >= 1,
    "a page turn should announce itself to the scene",
  );
  let peak = 0;
  // Sample long enough to survive a slow frame: the surge decays in about a
  // second, and a headless browser under load can miss a narrow window.
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(90);
    peak = Math.max(peak, (await read()).speed);
    if (peak > idle.speed * 2) break;
  }
  expect(
    peak > idle.speed * 2,
    `a page turn should speed the crawl up sharply, it peaked at ${peak.toFixed(4)}`,
  );

  // The other half of the effect: it has to come back. A surge that never
  // decays is just a faster figure, and that is a different, worse thing.
  let settled = false;
  for (let i = 0; i < 50 && !settled; i++) {
    await page.waitForTimeout(120);
    settled = (await read()).speed < idle.speed * 1.4;
  }
  expect(settled, "the crawl speed did not fall back after the page turn");
  await page.close();
}

// 8. The research ledger: the panel reads the generated index, and the index
//    describes topics that actually have a body behind them.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const notes = await page.evaluate(() => {
    const root = document.querySelector("#research .notes");
    return {
      state: root?.dataset.research,
      count: Number(root?.dataset.count ?? 0),
      links: [...document.querySelectorAll("#research .note-link")].map((a) =>
        a.getAttribute("href"),
      ),
      titles: [...document.querySelectorAll("#research .note h3")].map((h) =>
        h.textContent.trim(),
      ),
    };
  });
  expect(notes.state === "loaded", `research panel did not read the index: ${notes.state}`);
  expect(notes.count >= 3, `research panel shows ${notes.count} topics`);
  expect(
    notes.links.every((href) => /^\/?research\.html\?id=/.test(href ?? "")),
    `research links should be article pages: ${notes.links.join(", ")}`,
  );

  // The facet label lives in a narrow first column and spans three rows. A
  // `p`-wide rule once dragged it into column two, printing the tag and the
  // date straight over the summary — a regression only a screenshot had shown.
  const cardLayout = await page.evaluate(() => {
    const card = document.querySelector("#research .note");
    const tag = card.querySelector(".note-tag").getBoundingClientRect();
    const heading = card.querySelector("h3").getBoundingClientRect();
    const summary = card.querySelector("p:not(.note-tag)").getBoundingClientRect();
    return {
      tagRight: Math.round(tag.right),
      headingLeft: Math.round(heading.left),
      tagBottom: Math.round(tag.bottom),
      summaryTop: Math.round(summary.top),
    };
  });
  expect(
    cardLayout.tagRight < cardLayout.headingLeft,
    `the facet label sits in the copy column: ${JSON.stringify(cardLayout)}`,
  );

  const index = await page.evaluate(async () => {
    const response = await fetch("/research/index.json");
    return response.ok ? response.json() : null;
  });
  expect(index !== null, "research/index.json is missing from the build");
  expect(index?.topics?.length === notes.count, "the panel and the index disagree on the count");
  // The ledger collapses to two columns on a short screen. That layout used to
  // stack the tag and the heading in the same grid cell, so the copy printed on
  // top of itself — the sort of thing only a screenshot catches.
  const short = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  await short.goto(`${base}?lang=en`, { waitUntil: "domcontentloaded" });
  await short.waitForTimeout(1400);
  const stacked = await short.evaluate(() => {
    const card = document.querySelector("#research .note");
    const tag = card.querySelector(".note-tag").getBoundingClientRect();
    const heading = card.querySelector("h3").getBoundingClientRect();
    const title = document.querySelector("#research h2").getBoundingClientRect();
    const header = document.querySelector("header").getBoundingClientRect();
    return {
      overlap: tag.bottom > heading.top + 1,
      hidden: title.top < header.bottom,
    };
  });
  expect(!stacked.overlap, "short screen: the note tag overlaps its heading");
  expect(!stacked.hidden, "short screen: the research heading is under the header");
  await short.close();

  for (const topic of index?.topics ?? []) {
    expect(!!topic.id && !!topic.title?.zh, `topic is missing an id or a Chinese title: ${topic.id}`);
    expect(
      Array.isArray(topic.questions?.zh) && topic.questions.zh.length > 0,
      `${topic.id} has no questions — the search leans on them`,
    );
    const body = await page.evaluate(
      async (id) => (await fetch(`/research/topics/${id}.json`)).ok,
      topic.id,
    );
    expect(body, `${topic.id} has no topic payload`);
  }
  await page.close();
}

// 9. An entry opens as its own page, in both languages, and says so when the
//    slug does not exist.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}research.html?id=webgpu-performance`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#article[data-state="ready"]', { timeout: 15000 });
  const article = await page.evaluate(() => ({
    title: document.querySelector("#article h1")?.textContent?.trim(),
    sections: document.querySelectorAll("#article h2").length,
    words: document.querySelector("#article .article-text")?.textContent?.length ?? 0,
    metrics: !!document.querySelector("#article .article-json"),
  }));
  expect(article.title?.includes("WebGPU"), `article title was "${article.title}"`);
  expect(article.sections >= 4, `article rendered ${article.sections} sections`);
  expect(article.words > 1200, `article body is only ${article.words} characters`);
  expect(article.metrics, "article should show the measured data file");

  const tablePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await tablePage.goto(`${base}research.html?id=gpu-crawl`, { waitUntil: "domcontentloaded" });
  await tablePage.waitForSelector('#article[data-state="ready"]', { timeout: 15000 });
  expect(
    (await tablePage.$$("#article table")).length > 0,
    "markdown tables should render as tables",
  );
  expect((await overflow(tablePage)) === 0, "article page overflows horizontally");

  await page.goto(`${base}research.html?id=webgpu-performance&lang=en`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('#article[data-state="ready"]', { timeout: 15000 });
  expect((await page.getAttribute("html", "lang")) === "en", "article should honour lang=en");
  const english = await page.textContent("#article h1");
  expect(
    english?.includes("WebGPU"),
    `English article title was "${english}"`,
  );
  await page.click("#article-language");
  await page.waitForTimeout(600);
  expect(
    (await page.getAttribute("html", "lang")) === "zh-CN",
    "the article's language button should return to Chinese",
  );

  await page.goto(`${base}research.html?id=does-not-exist`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  expect(
    (await page.getAttribute("#article", "data-state")) === "missing",
    "an unknown slug should render the missing state",
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(`${base}research.html?id=lattice-seam`, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector('#article[data-state="ready"]', { timeout: 15000 });
  expect((await overflow(mobile)) === 0, "mobile article overflows horizontally");
  await mobile.close();

  // Without JavaScript the panel keeps the hand-written cards, links included.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const plainPage = await plain.newPage();
  await plainPage.goto(base, { waitUntil: "load" });
  const staticCards = await plainPage.evaluate(() => {
    const cards = [...document.querySelectorAll("#research .note")];
    return {
      count: cards.length,
      links: [...document.querySelectorAll("#research .note-link")].map((a) =>
        a.getAttribute("href"),
      ),
    };
  });
  expect(staticCards.count === 3, `no-JS: expected 3 static cards, got ${staticCards.count}`);
  expect(
    staticCards.links.every((href) => /^\/?research\.html\?id=/.test(href ?? "")),
    "no-JS: static cards should link to the article pages",
  );
  await plain.close();
  await tablePage.close();
  await page.close();
}

// 10. The header menu: hover opens it, it is built from the index, and Escape
//     closes it. It is not in the markup, so a broken fetch would leave an
//     empty box rather than an obvious error.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);

  const researchItem = '[data-nav-item][data-nav-kind="research"]';
  await page.locator(`${researchItem} > a`).hover();
  await page.waitForTimeout(500);
  const menu = await page.evaluate((selector) => {
    const item = document.querySelector(selector);
    const root = item.querySelector("[data-nav-menu]");
    return {
      expanded: item.querySelector("a").getAttribute("aria-expanded"),
      visible: getComputedStyle(root).visibility,
      state: root.dataset.state,
      entries: [...root.querySelectorAll(".nav-menu-entry")].map((a) => a.getAttribute("href")),
      tracks: [...root.querySelectorAll(".nav-menu-track")].map((a) => a.getAttribute("href")),
      all: root.querySelector(".nav-menu-all")?.getAttribute("href") ?? "",
    };
  }, researchItem);
  expect(menu.expanded === "true", "hovering Research should expand the menu");
  expect(menu.visible === "visible", `the menu should be visible on hover, it is ${menu.visible}`);
  expect(menu.state === "loaded", `the menu is in state "${menu.state}"`);
  expect(
    menu.entries.length >= 1 && menu.entries.length <= 4,
    `the menu lists ${menu.entries.length} entries`,
  );
  expect(
    menu.entries.every((href) => /^\/?research\.html\?id=/.test(href ?? "")),
    "menu entries should open article pages",
  );
  expect(
    menu.tracks.length > 0 &&
      menu.tracks.every((href) => /^\/?research\.html\?track=/.test(href ?? "")),
    `menu tracks should filter the shelf: ${menu.tracks.join(", ")}`,
  );
  expect(/research\.html$/.test(menu.all), `the menu's all-link points at "${menu.all}"`);

  await page.keyboard.press("Escape");
  const expandedAfter = await page.evaluate(
    (selector) => document.querySelector(selector).querySelector("a").getAttribute("aria-expanded"),
    researchItem,
  );
  expect(expandedAfter === "false", "Escape should collapse the menu");
  // The fade-out waits on the main thread, which the scene is also using. Wait
  // for the state instead of guessing a duration.
  const hid = await page
    .waitForFunction(
      (selector) =>
        getComputedStyle(
          document.querySelector(selector).querySelector("[data-nav-menu]"),
        ).visibility === "hidden",
      researchItem,
      { timeout: 3000 },
    )
    .then(() => true)
    .catch(() => false);
  expect(hid, "Escape should make the menu invisible");
  await page.close();
}

// 11. The shelf: `research.html` without an id lists everything, and the
//     filters actually remove rows.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}research.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#article[data-state="library"]', { timeout: 15000 });

  const shelf = await page.evaluate(() => ({
    rows: document.querySelectorAll(".library-row").length,
    chips: [...document.querySelectorAll(".library-chip")].map((chip) => chip.dataset.track),
    search: !!document.querySelector(".library-search"),
  }));
  expect(shelf.rows >= 3, `the shelf lists ${shelf.rows} rows`);
  expect(
    shelf.chips.length >= 2 && shelf.chips[0] === "",
    `the shelf needs an "all" chip first: ${shelf.chips.join(", ")}`,
  );
  expect(shelf.search, "the shelf needs a search field");

  const total = shelf.rows;
  await page.click('.library-chip[data-track="rendering"]');
  await page.waitForTimeout(250);
  const filtered = await page.evaluate(() => ({
    rows: document.querySelectorAll(".library-row").length,
    url: location.search,
  }));
  expect(
    filtered.rows > 0 && filtered.rows < total,
    `filtering gave ${filtered.rows} of ${total} rows`,
  );
  expect(filtered.url.includes("track=rendering"), "the filter belongs in the URL");

  await page.fill(".library-search", "zzzzz");
  await page.waitForTimeout(250);
  const empty = await page.evaluate(() => ({
    rows: document.querySelectorAll(".library-row").length,
    empty: !document.querySelector(".library-empty").hidden,
  }));
  expect(
    empty.rows === 0 && empty.empty,
    "a query with no hits should show the empty state",
  );

  const english = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await english.goto(`${base}research.html?lang=en`, { waitUntil: "domcontentloaded" });
  await english.waitForSelector('#article[data-state="library"]', { timeout: 15000 });
  expect(
    (await english.textContent("#article h1"))?.includes("newest first"),
    "the English shelf should be in English",
  );
  expect((await overflow(english)) === 0, "the shelf overflows horizontally");

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(`${base}research.html`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('#article[data-state="library"]', { timeout: 15000 });
  expect((await overflow(phone)) === 0, "the shelf overflows on a phone");

  await phone.close();
  await english.close();
  await page.close();
}

// 12. The panel is a window, not the shelf: it caps the cards and hands the
//     rest to the library.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const panel = await page.evaluate(() => {
    const root = document.querySelector("#research .notes");
    return {
      shown: Number(root.dataset.shown ?? 0),
      total: Number(root.dataset.count ?? 0),
      cards: document.querySelectorAll("#research .note").length,
      more: document.querySelector(".notes-more")?.getAttribute("href") ?? "",
      moreLabel: document.querySelector(".notes-more")?.textContent?.trim() ?? "",
    };
  });
  expect(panel.shown > 0, "the panel should report how many cards it drew");
  expect(panel.cards === panel.shown, `the panel drew ${panel.cards} of ${panel.shown}`);
  expect(panel.shown <= 4, `the panel shows ${panel.shown} cards, the cap is 4`);
  expect(
    /research\.html$/.test(panel.more),
    `the panel should hand off to the shelf, pointing at "${panel.more}"`,
  );
  expect(panel.moreLabel.includes(String(panel.total)), `the hand-off should say ${panel.total}`);
  await page.close();
}

// 13. The product panel is read from the index, and it is the same block the
//     build wrote into the HTML — so a failed fetch costs nothing.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const index = await page.evaluate(async () => {
    const response = await fetch("/product/index.json");
    return response.ok ? response.json() : null;
  });
  expect(index !== null, "product/index.json is missing from the build");
  const products = index?.products ?? [];
  expect(products.length > 0, "the product index is empty");

  const panel = await page.evaluate(() => {
    const root = document.querySelector("[data-product-panel]");
    const feature = root?.querySelector(".product-feature");
    return {
      state: root?.dataset.productPanel,
      count: Number(root?.dataset.count ?? 0),
      featured: feature?.dataset.product,
      name: root?.querySelector("#product-title")?.textContent?.trim(),
      titleHref: root?.querySelector("#product-title a")?.getAttribute("href"),
      features: root?.querySelectorAll(".features dt").length ?? 0,
      status: root?.querySelector(".status-line")?.textContent?.trim() ?? "",
      links: [...(root?.querySelectorAll(".product-actions a") ?? [])].map((a) =>
        a.getAttribute("href"),
      ),
      rest: root?.querySelectorAll(".product-rest-item").length ?? 0,
    };
  });

  expect(panel.state === "loaded", `product panel did not read the index: ${panel.state}`);
  expect(panel.count === products.length, `the panel reports ${panel.count} of ${products.length}`);
  expect(
    panel.featured === products[0].id,
    `the panel features "${panel.featured}", the index leads with "${products[0].id}"`,
  );
  expect(panel.name === products[0].name, `panel heading is "${panel.name}"`);
  expect(
    panel.features === Math.min(4, products[0].highlights.length),
    `the panel drew ${panel.features} of ${products[0].highlights.length} highlights`,
  );
  expect(
    panel.titleHref === `product.html?id=${products[0].id}`,
    `the product heading should open its page, it points at "${panel.titleHref}"`,
  );
  expect(
    panel.links.some((href) => /^https:\/\//.test(href ?? "")),
    `the panel needs a real action link: ${panel.links.join(", ")}`,
  );
  expect(panel.status.includes("v" + products[0].version), "the status line should carry the version");
  if (products.length > 1) {
    expect(
      panel.rest === products.length - 1,
      `the panel lists ${panel.rest} of ${products.length - 1} other products`,
    );
  }
  expect(errors.length === 0, `product panel raised: ${errors.join(" | ")}`);

  // A short window is where a long panel hides its own buttons under the
  // footer. The inner box scrolls instead of overflowing.
  const short = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  await short.goto(`${base}#product`, { waitUntil: "domcontentloaded" });
  await short.waitForTimeout(1400);
  const fit = await short.evaluate(() => {
    const inner = document.querySelector("#product .panel-inner");
    const box = inner.getBoundingClientRect();
    const foot = document.querySelector("#product .panel-foot").getBoundingClientRect();
    return {
      bottom: Math.round(box.bottom),
      footTop: Math.round(foot.top),
      hidden: inner.scrollHeight > inner.clientHeight + 1,
      // A second product adds a row here. The panel is allowed to grow past the
      // box then, but only if the box scrolls instead of swallowing the tail.
      scrolls: getComputedStyle(inner).overflowY === "auto",
    };
  });
  expect(fit.bottom <= fit.footTop, `short screen: the panel runs into its footer ${JSON.stringify(fit)}`);
  expect(
    !fit.hidden || fit.scrolls,
    `short screen: the product panel clips its own content ${JSON.stringify(fit)}`,
  );
  await short.close();

  // With the index blocked, the build-time block stays on screen.
  const blocked = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await blocked.route("**/product/index.json", (route) => route.abort());
  await blocked.goto(base, { waitUntil: "domcontentloaded" });
  await blocked.waitForTimeout(1400);
  const kept = await blocked.evaluate(() => ({
    state: document.querySelector("[data-product-panel]")?.dataset.productPanel,
    name: document.querySelector("#product h2")?.textContent?.trim(),
    features: document.querySelectorAll("#product .features dt").length,
  }));
  expect(kept.state === "fallback", `a blocked index should fall back, got "${kept.state}"`);
  expect(kept.name === products[0].name, `the fallback block lost its heading: "${kept.name}"`);
  expect(kept.features > 0, "the fallback block lost its highlights");
  await blocked.close();
  await page.close();
}

// 14. The catalogue: every product as a card, each one opening its own page.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}product.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#product[data-state="catalog"]', { timeout: 15000 });

  const index = await page.evaluate(async () => {
    const response = await fetch("/product/index.json");
    return response.ok ? response.json() : null;
  });
  const products = index?.products ?? [];

  const shelf = await page.evaluate(() => ({
    cards: [...document.querySelectorAll(".product-card")].map((card) => ({
      id: card.dataset.product,
      href: card.getAttribute("href"),
      name: card.querySelector(".product-card-name")?.textContent?.trim(),
    })),
    chips: document.querySelectorAll(".library-chip").length,
    title: document.querySelector("#product h1")?.textContent?.trim(),
  }));
  expect(shelf.cards.length === products.length, `the catalogue lists ${shelf.cards.length} of ${products.length}`);
  expect(
    shelf.cards.every((card) => card.href === `product.html?id=${card.id}`),
    `a card does not open its product: ${shelf.cards.map((c) => c.href).join(", ")}`,
  );
  expect(
    shelf.cards.every((card) => card.name === products.find((p) => p.id === card.id)?.name),
    "a card's name does not match the index",
  );
  // A filter row with one category filters nothing.
  const categories = new Set(products.map((product) => product.category));
  expect(
    categories.size > 1 ? shelf.chips > 1 : shelf.chips === 0,
    `the catalogue drew ${shelf.chips} filter chips for ${categories.size} categories`,
  );
  expect((await overflow(page)) === 0, "the catalogue overflows horizontally");

  const english = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await english.goto(`${base}product.html?lang=en`, { waitUntil: "domcontentloaded" });
  await english.waitForSelector('#product[data-state="catalog"]', { timeout: 15000 });
  expect(
    (await english.textContent("#product h1"))?.includes("Everything we build"),
    "the English catalogue should be in English",
  );
  expect((await overflow(english)) === 0, "the English catalogue overflows horizontally");

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(`${base}product.html`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('#product[data-state="catalog"]', { timeout: 15000 });
  expect((await overflow(phone)) === 0, "the catalogue overflows on a phone");

  await phone.close();
  await english.close();
  await page.close();
}

// 15. One product as a page: its own copy, its facts, its links, both languages.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // A page has to be on the site before `fetch("/...")` means anything.
  await page.goto(`${base}product.html`, { waitUntil: "domcontentloaded" });
  const index = await page.evaluate(async () => {
    const response = await fetch("/product/index.json");
    return response.ok ? response.json() : null;
  });
  const product = index?.products?.[0];
  await page.goto(`${base}product.html?id=${product.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#product[data-state="ready"]', { timeout: 15000 });

  const detail = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector("#product h1")?.textContent?.trim(),
    crumb: document.querySelector("[data-copy='current']")?.textContent?.trim(),
    kicker: document.querySelector(".article-kicker")?.textContent?.trim() ?? "",
    highlights: document.querySelectorAll(".product-highlights > div").length,
    facts: document.querySelectorAll(".product-fact-list > div").length,
    actions: [...document.querySelectorAll(".product-actions a")].map((a) => a.getAttribute("href")),
    words: document.querySelector(".article-text")?.textContent?.length ?? 0,
    sections: document.querySelectorAll(".article-text h2").length,
  }));
  expect(detail.h1 === product.name, `product page title was "${detail.h1}"`);
  expect(detail.title.includes(product.name), `document title was "${detail.title}"`);
  expect(detail.crumb === product.name, `the breadcrumb ends at "${detail.crumb}"`);
  expect(detail.kicker.length > 0, "the product page needs a category and stage line");
  expect(
    detail.highlights === product.highlights.length,
    `the page shows ${detail.highlights} of ${product.highlights.length} highlights`,
  );
  expect(detail.facts === product.facts.length, `the page shows ${detail.facts} of ${product.facts.length} facts`);
  expect(
    detail.actions.some((href) => href === product.links[0]?.href),
    `the page should link to ${product.links[0]?.href}`,
  );
  expect(detail.words > 400, `the product notes are only ${detail.words} characters`);
  expect(detail.sections >= 2, "the product notes should keep their headings");
  expect((await overflow(page)) === 0, "the product page overflows horizontally");

  await page.goto(`${base}product.html?id=${product.id}&lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#product[data-state="ready"]', { timeout: 15000 });
  expect((await page.getAttribute("html", "lang")) === "en", "the product page should honour lang=en");
  expect(
    (await page.textContent("#product .article-lead"))?.includes(product.tagline.en),
    "the English product page should use the English tagline",
  );
  await page.click("#product-language");
  await page.waitForTimeout(600);
  expect(
    (await page.getAttribute("html", "lang")) === "zh-CN",
    "the product page's language button should return to Chinese",
  );

  await page.goto(`${base}product.html?id=not-a-product`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  expect(
    (await page.getAttribute("#product", "data-state")) === "missing",
    "an unknown product should render the missing state",
  );

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(`${base}product.html?id=${product.id}`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector('#product[data-state="ready"]', { timeout: 15000 });
  expect((await overflow(phone)) === 0, "the product page overflows on a phone");
  await phone.close();
  await page.close();
}

// 16. The header's product menu, from the same index.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  await page.locator('[data-nav-item][data-nav-kind="product"] > a').hover();
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => {
    const item = document.querySelector('[data-nav-item][data-nav-kind="product"]');
    const root = item.querySelector("[data-nav-menu]");
    return {
      state: root.dataset.state,
      visible: getComputedStyle(root).visibility,
      entries: [...root.querySelectorAll(".nav-menu-entry")].map((a) => a.getAttribute("href")),
      all: root.querySelector(".nav-menu-all")?.getAttribute("href") ?? "",
      researchOpen: document.querySelector('[data-nav-item][data-nav-kind="research"]').dataset.open,
    };
  });
  expect(menu.state === "loaded", `the product menu is in state "${menu.state}"`);
  expect(menu.visible === "visible", "hovering Product should show its menu");
  expect(menu.entries.length > 0, "the product menu lists nothing");
  expect(
    menu.entries.every((href) => /^product\.html\?id=/.test(href ?? "")),
    `product menu entries should open product pages: ${menu.entries.join(", ")}`,
  );
  expect(/^product\.html/.test(menu.all), `the product menu's catalogue link points at "${menu.all}"`);
  expect(menu.researchOpen === "false", "opening one menu should close the other");
  await page.close();
}

// 17. Without JavaScript the product panel is still a product, not a heading
//     waiting for a fetch: it was rendered into the HTML at build time.
{
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  const panel = await page.evaluate(() => ({
    name: document.querySelector("#product h2")?.textContent?.trim(),
    features: document.querySelectorAll("#product .features dt").length,
    links: [...document.querySelectorAll("#product .product-actions a")].map((a) =>
      a.getAttribute("href"),
    ),
    detail: document.querySelector("#product h2 a")?.getAttribute("href"),
  }));
  expect(!!panel.name, "no-JS: the product panel has no heading");
  expect(panel.features > 0, "no-JS: the product panel has no highlights");
  expect(
    panel.links.some((href) => /^https:\/\//.test(href ?? "")),
    "no-JS: the product panel has no working link",
  );
  expect(
    panel.detail === "product.html?id=graphfin" || /^product\.html\?id=/.test(panel.detail ?? ""),
    `no-JS: the heading should open the product page, it points at "${panel.detail}"`,
  );
  await context.close();
}

// 18. A detail page is its own document. The static canonical in research.html
//     points at the ledger, so without this the search engine is told to fold
//     every entry into the list — the entries would never rank on their own.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}research.html?id=gpu-crawl`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('#article[data-state="ready"]', { timeout: 15000 });
  const topic = await page.getAttribute("link[rel=canonical]", "href");
  expect(
    topic?.includes("research.html?id=gpu-crawl"),
    `the topic canonical should name the topic, it is "${topic}"`,
  );

  await page.goto(`${base}research.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const ledger = await page.getAttribute("link[rel=canonical]", "href");
  expect(
    ledger?.endsWith("research.html"),
    `the ledger canonical should be the ledger, it is "${ledger}"`,
  );

  await page.goto(`${base}product.html?id=graphfin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const product = await page.getAttribute("link[rel=canonical]", "href");
  expect(
    product?.includes("product.html?id=graphfin"),
    `the product canonical should name the product, it is "${product}"`,
  );
  await page.close();
}

await browser.close();

// 19. The sitemap is generated from the two indexes, so it cannot go stale the
//     way the hand-kept one did: every catalogue row is a URL, and robots.txt
//     still points at the map.
{
  const get = async (path) => (await fetch(`${base}${path}`)).text();
  const [map, robots, productIndex, researchIndex] = await Promise.all([
    get("sitemap.xml"),
    get("robots.txt"),
    get("product/index.json").then(JSON.parse),
    get("research/index.json").then(JSON.parse),
  ]);
  expect(map.startsWith('<?xml version="1.0"'), "sitemap.xml should be an XML document");
  expect(map.includes("<loc>https://idefinity.com/</loc>"), "the sitemap is missing the deck");
  expect(
    robots.includes("Sitemap: https://idefinity.com/sitemap.xml"),
    "robots.txt lost its sitemap line",
  );
  for (const product of productIndex.products) {
    expect(
      map.includes(`product.html?id=${product.id}`),
      `the sitemap is missing product "${product.id}"`,
    );
  }
  for (const topic of researchIndex.topics) {
    expect(
      map.includes(`research.html?id=${topic.id}`),
      `the sitemap is missing research entry "${topic.id}"`,
    );
  }
  expect(!/undefined|\[object/.test(map), "the sitemap carries a broken field");
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
