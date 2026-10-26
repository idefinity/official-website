/**
 * Chinese is the page. English is a translation layer on top of it, so the HTML
 * works on its own without JavaScript — crawlers, no-JS browsers and the
 * WebGL-failure path all read the Chinese copy.
 */
const english: Record<string, string> = {
  skip: "Skip to content",
  menu: "Menu",
  navResearch: "Research",
  navProduct: "Product",
  navAbout: "About",
  navAllResearch: "All research",
  navAllProducts: "All products",
  eyebrow: "Shenzhen Ideafinity Technology · Shenzhen",
  headlineOne: "Make connections",
  headlineTwo: "visible.",
  description:
    "We build a graph database, and the interface that goes with it. How records connect, and how they change over time, should be legible in one view.",
  seeProduct: "See the product",
  readNotes: "Read the notes",
  source: "Browse the code on GitHub",
  visualCaption: "Infinite loop · rendered live",
  visualCaptionStill: "Infinite loop · still frame",
  introduction: "Overview",
  backToTop: "Back to the start",
  heroNote: "Relationships · Time · Queries",
  researchLabel: "Research",
  researchTitle: "Every question we asked is on file.",
  researchLead:
    "One entry per question: what we wanted to know, what we measured, what changed. Anything unmeasured is marked unverified instead of being written up as a conclusion.",
  noteOneTag: "Performance · Active",
  noteOneTitle: "What WebGPU would actually buy this scene",
  noteOneText:
    "The cost sits in fill rate and the post chain, not in draw calls. Budgeting the bandwidth says 10–20 percent: worth a spike, not worth a rewrite.",
  noteOneLink: "Experiment · read it",
  noteTwoTag: "Graphics · Shipped",
  noteTwoTitle: "Moving the crawl into the vertex shader for 1.1 ms",
  noteTwoText:
    "The curve baked into a texture, the phase reduced to one uniform. 1610 matrices stop being rebuilt each frame; the main thread drops from 2.5 to 1.39 ms.",
  noteTwoLink: "Experiment · read it",
  noteThreeTag: "Graphics · Shipped",
  noteThreeTitle: "Why the honeycomb would not close",
  noteThreeText:
    "With an odd column count the lattice ends half a cell out of step, leaving a ring of atoms with two bonds instead of three. It looks like overlap; it is a missing bond.",
  noteThreeLink: "Note · read it",
  productLabel: "Product",
  aboutLabel: "About",
  aboutTitle: "A small company in Shenzhen.",
  aboutQuote:
    "\u201cInfinite\u201d means staying with one problem longer, not doing everything.",
  aboutText:
    "Ideafinity builds database software. Right now most of the attention goes to GraphFin: storage, queries, and the interface that makes the data readable. The company is small enough that every decision traces back to a person and a conversation.",
  contactEmail: "Email",
  contactCode: "Code",
  contactIcp: "ICP filing",
  footerCompany: "© 2026 Shenzhen Ideafinity Technology Co., Ltd.",
  footerLicense: "Apache 2.0",
};

const chineseTitle = "idefinity — 想法无限科技";
const englishTitle = "idefinity — Shenzhen Ideafinity Technology";

export function setupLanguage(onChange: () => void) {
  const elements = [...document.querySelectorAll<HTMLElement>("[data-i18n]")];
  // Capture the Chinese copy before anything overwrites it.
  const chinese = Object.fromEntries(
    elements.map((element) => [
      element.dataset.i18n!,
      element.textContent!.replace(/\s+/g, " ").trim(),
    ]),
  ) as Record<string, string>;

  const button = document.querySelector<HTMLButtonElement>("#language")!;
  const labels = [...button.querySelectorAll<HTMLElement>("[data-language]")];
  let language: "zh" | "en" =
    new URL(location.href).searchParams.get("lang") === "en" ? "en" : "zh";

  const text = (key: string) =>
    (language === "en" ? english[key] : chinese[key]) ?? chinese[key] ?? key;

  function setAttribute(selector: string, attribute: string, value: string) {
    document.querySelector(selector)?.setAttribute(attribute, value);
  }

  function apply() {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    for (const element of elements) {
      element.textContent = text(element.dataset.i18n!);
    }
    for (const label of labels) {
      const active = label.dataset.language === language;
      label.classList.toggle("selected", active);
    }
    button.setAttribute(
      "aria-label",
      language === "en" ? "切换为中文" : "Switch to English",
    );
    button.setAttribute("aria-pressed", String(language === "en"));
    setAttribute(
      "nav",
      "aria-label",
      language === "en" ? "Main navigation" : "主导航",
    );
    setAttribute(
      ".brand",
      "aria-label",
      language === "en" ? "idefinity home" : "idefinity 首页",
    );
    document.title = language === "en" ? englishTitle : chineseTitle;
    const description = text("description");
    setAttribute('meta[name="description"]', "content", description);
    setAttribute('meta[property="og:title"]', "content", document.title);
    setAttribute('meta[property="og:description"]', "content", description);
    onChange();
  }

  button.hidden = false;
  button.addEventListener("click", () => {
    language = language === "en" ? "zh" : "en";
    const url = new URL(location.href);
    if (language === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    history.replaceState(null, "", url);
    apply();
  });
  apply();
  return { text };
}
