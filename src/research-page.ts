/**
 * One research entry, as a page.
 *
 * Reads `?id=<slug>` and fetches exactly one payload from
 * `public/research/topics/<slug>.json`. No scene, no WebGL: a note should open
 * on a phone in a train tunnel with two bars of signal.
 */
import "./tokens.css";
import "./article.css";
import { paintLibrary } from "./library.ts";
import { renderMarkdown } from "./markdown.ts";
import {
  facets,
  kindLabel,
  loadIndex,
  pick,
  readResearchIndex,
  readTopic,
  topicUrl,
  type Language,
  type ResearchIndex,
  type TopicDetail,
} from "./research.ts";

const params = new URLSearchParams(location.search);
const slug = params.get("id") ?? "";
let language: Language = params.get("lang") === "en" ? "en" : "zh";

const COPY = {
  zh: {
    back: "研究台账",
    home: "首页",
    all: "全部课题",
    questions: "当初想问什么",
    verdict: "结论",
    data: "数据",
    links: "相关",
    prev: "前一条",
    next: "后一条",
    updated: "更新于",
    minutes: (count: number) => `约 ${count} 分钟`,
    missing: "没有这一条。",
    missingHint: "链接可能写错了，或者这条记录已经并进了别处。从台账里重新找一条。",
    switch: "EN",
    title: "研究台账 — idefinity",
  },
  en: {
    back: "Research ledger",
    home: "Home",
    all: "All entries",
    questions: "The questions",
    verdict: "Verdict",
    data: "Data",
    links: "Related",
    prev: "Previous",
    next: "Next",
    updated: "Updated",
    minutes: (count: number) => `${count} min read`,
    missing: "No such entry.",
    missingHint: "The link may be wrong, or the entry was folded into another one. Pick a new one from the ledger.",
    switch: "中文",
    title: "Research ledger — idefinity",
  },
} as const;

const copy = () => COPY[language];
const article = document.querySelector<HTMLElement>("#article")!;
const header = document.querySelector<HTMLElement>(".ledger-head")!;

function paintChrome() {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  const back = header.querySelector<HTMLAnchorElement>("[data-copy='back']")!;
  back.textContent = copy().back;
  // The shelf is the ledger itself, so "back" there means the deck, not a page
  // that is already on screen.
  if (!slug) {
    back.textContent = copy().home;
    back.href = `/${language === "en" ? "?lang=en" : ""}`;
  }
  const toggle = header.querySelector<HTMLButtonElement>("#article-language")!;
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

function section(title: string, className = "") {
  const element = document.createElement("section");
  element.className = `article-section ${className}`.trim();
  const heading = document.createElement("h2");
  heading.textContent = title;
  element.append(heading);
  return element;
}

function paint(detail: TopicDetail, index: ResearchIndex | null) {
  const text = copy();
  document.title = `${pick(detail.title, language)} — idefinity`;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = pick(detail.summary, language);

  const fragment = document.createDocumentFragment();

  const kicker = document.createElement("p");
  kicker.className = "article-kicker";
  kicker.textContent = `${facets(detail, language, index?.taxonomy)} · ${kindLabel(
    detail,
    language,
    index?.taxonomy,
  )}`;

  const title = document.createElement("h1");
  title.textContent = pick(detail.title, language);

  const lead = document.createElement("p");
  lead.className = "article-lead";
  lead.textContent = pick(detail.summary, language);

  const meta = document.createElement("p");
  meta.className = "article-meta";
  meta.textContent = `${text.updated} ${detail.updated} · ${text.minutes(detail.minutes)}`;

  fragment.append(kicker, title, lead, meta);

  // English questions fall back to Chinese only when nobody wrote the English
  // ones; showing the Chinese is better than showing an empty section.
  const asked =
    language === "en"
      ? detail.questions?.en?.length
        ? detail.questions.en
        : detail.questions?.zh ?? []
      : detail.questions?.zh ?? [];

  if (asked.length) {
    const questions = section(text.questions, "article-questions");
    const list = document.createElement("ul");
    for (const question of asked) {
      const item = document.createElement("li");
      item.textContent = question;
      list.append(item);
    }
    questions.append(list);
    fragment.append(questions);
  }

  if (detail.verdict) {
    const verdict = document.createElement("p");
    verdict.className = "article-verdict";
    verdict.textContent = detail.verdict;
    fragment.append(verdict);
  }

  const body = document.createElement("div");
  body.className = "article-text";
  const note = language === "en" ? detail.notes.en || detail.notes.zh : detail.notes.zh;
  body.innerHTML = renderMarkdown(note, { dropFirstHeading: true });
  fragment.append(body);

  const charts = Object.entries(detail.data ?? {});
  if (charts.length) {
    const data = section(text.data, "article-data");
    for (const [path, content] of charts) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = path.replace(/^data\//, "");
      const pre = document.createElement("pre");
      pre.className = "article-json";
      pre.textContent = content.trim();
      details.append(summary, pre);
      data.append(details);
    }
    fragment.append(data);
  }

  if (detail.links?.length) {
    const links = section(text.links, "article-links");
    const list = document.createElement("ul");
    for (const link of detail.links) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      if (/^https?:\/\//.test(link.href)) {
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
      }
      item.append(anchor);
      list.append(item);
    }
    links.append(list);
    fragment.append(links);
  }

  const neighbours = index?.topics ?? [];
  const position = neighbours.findIndex((topic) => topic.id === detail.id);
  if (position >= 0 && neighbours.length > 1) {
    const nav = document.createElement("nav");
    nav.className = "article-nav";
    // Sorted newest first: "previous" is the older entry, which reads backwards
    // from the list. Label them by direction in the ledger, not by date.
    const older = neighbours[position + 1];
    const newer = neighbours[position - 1];
    if (older) nav.append(navLink(text.prev, older.id));
    if (newer) nav.append(navLink(text.next, newer.id));
    fragment.append(nav);
  }

  article.replaceChildren(fragment);
  article.dataset.state = "ready";
}

function navLink(label: string, id: string) {
  const anchor = document.createElement("a");
  anchor.className = "article-nav-link";
  anchor.href = topicUrl(id, language);
  const small = document.createElement("span");
  small.textContent = label;
  const heading = document.createElement("strong");
  heading.textContent = id;
  anchor.append(small, heading);
  return anchor;
}

function showMissing() {
  const text = copy();
  const wrap = document.createElement("div");
  wrap.className = "article-missing";
  const heading = document.createElement("h1");
  heading.textContent = text.missing;
  const hint = document.createElement("p");
  hint.textContent = text.missingHint;
  const back = document.createElement("a");
  back.className = "article-back";
  back.href = language === "en" ? "/research.html?lang=en" : "/research.html";
  back.textContent = text.all;
  wrap.append(heading, hint, back);
  article.replaceChildren(wrap);
  article.dataset.state = "missing";
}

async function boot() {
  paintChrome();
  document
    .querySelector("#article-language")
    ?.addEventListener("click", toggleLanguage);

  // No slug means the shelf, not a broken link: `research.html` is the index
  // and `research.html?id=` is one entry.
  if (!slug) {
    try {
      const index = await loadIndex();
      paintLibrary(article, index, language, {
        track: params.get("track"),
        query: params.get("q"),
      });
    } catch {
      showMissing();
    }
    return;
  }

  try {
    const detail = await readTopic(slug);
    const index = await readResearchIndex().catch(() => null);
    paint(detail, index);
  } catch {
    showMissing();
  }
}

void boot();
