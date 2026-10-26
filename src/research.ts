/**
 * The reading half of the research ledger.
 *
 * `public/research/index.json` is written by `scripts/research.mjs` at build
 * time: one entry per topic, no body text, plus the vocabulary the shelf uses
 * (tracks, kinds, statuses, series). The deck reads that for the cards and the
 * menu; the article page reads one topic payload, so a single note costs one
 * small request.
 *
 * Nothing here throws on a missing index. The panel ships with hand-written
 * cards in the HTML, and that copy is what a reader sees when the fetch fails —
 * same three topics, same links, no JavaScript.
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

export interface Taxonomy {
  schema?: string;
  tracks: Facet[];
  kinds: Facet[];
  statuses: Facet[];
  series?: Facet[];
}

export interface TopicSummary {
  id: string;
  title: Localized;
  summary: Localized;
  track: string;
  kind: string;
  status: string;
  tags: string[];
  series: string[];
  questions: { zh: string[]; en?: string[] };
  verdict: string;
  created: string;
  updated: string;
  words: { zh: number; en: number };
  minutes: number;
}

export interface TopicDetail extends TopicSummary {
  notes: { zh: string; en: string };
  data: Record<string, string>;
  links: { label: string; href: string }[];
}

export interface ResearchIndex {
  schema: string;
  generated: string;
  taxonomy?: Taxonomy;
  counts: {
    topics: number;
    byTrack: Record<string, number>;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    bySeries?: Record<string, number>;
  };
  topics: TopicSummary[];
}

/**
 * The vocabulary as it was before it moved into `research/taxonomy.json`. It is
 * only a safety net for the case where the index arrives without one — a new
 * track is named in the JSON and shows up here for free.
 */
const BUILT_IN: Record<keyof Omit<Taxonomy, "schema">, Record<string, Localized>> = {
  tracks: {
    rendering: { zh: "图形", en: "Rendering" },
    performance: { zh: "性能", en: "Performance" },
    data: { zh: "数据", en: "Data" },
    interface: { zh: "界面", en: "Interface" },
    tooling: { zh: "工具", en: "Tooling" },
    writing: { zh: "写作", en: "Writing" },
  },
  kinds: {
    study: { zh: "读", en: "Study" },
    experiment: { zh: "实测", en: "Experiment" },
    note: { zh: "记录", en: "Note" },
    decision: { zh: "取舍", en: "Decision" },
  },
  statuses: {
    idea: { zh: "想法", en: "Idea" },
    active: { zh: "进行中", en: "Active" },
    shipped: { zh: "已落地", en: "Shipped" },
    paused: { zh: "暂停", en: "Paused" },
    dropped: { zh: "放弃", en: "Dropped" },
  },
  series: {},
};

export type Language = "zh" | "en";

export const currentLanguage = (): Language =>
  document.documentElement.lang === "en" ? "en" : "zh";

export const pick = (value: Localized | undefined, language: Language): string =>
  (language === "en" ? value?.en || value?.zh : value?.zh) ?? "";

/** Display name for one facet id, falling back to the id itself. */
export function nameFor(
  taxonomy: Taxonomy | null | undefined,
  group: keyof Omit<Taxonomy, "schema">,
  id: string,
  language: Language,
): string {
  const entry = taxonomy?.[group]?.find((item) => item.id === id);
  if (entry) return pick(entry, language) || id;
  const builtIn = BUILT_IN[group]?.[id];
  return builtIn ? pick(builtIn, language) || id : id;
}

const base = () => import.meta.env.BASE_URL;

export const topicUrl = (id: string, language: Language = currentLanguage()) =>
  `${base()}research.html?id=${encodeURIComponent(id)}${language === "en" ? "&lang=en" : ""}`;

export const libraryUrl = (
  options: { track?: string } = {},
  language: Language = currentLanguage(),
) => {
  const params = new URLSearchParams();
  if (options.track) params.set("track", options.track);
  if (language === "en") params.set("lang", "en");
  const query = params.toString();
  return `${base()}research.html${query ? `?${query}` : ""}`;
};

/** `性能 · 进行中` — the two facets that tell a reader what this is. */
export function facets(
  topic: TopicSummary,
  language: Language,
  taxonomy?: Taxonomy | null,
): string {
  return [
    nameFor(taxonomy, "tracks", topic.track, language),
    nameFor(taxonomy, "statuses", topic.status, language),
  ].join(" · ");
}

export function kindLabel(
  topic: TopicSummary,
  language: Language,
  taxonomy?: Taxonomy | null,
): string {
  return nameFor(taxonomy, "kinds", topic.kind, language);
}

export function readResearchIndex(): Promise<ResearchIndex> {
  return fetch(`${base()}research/index.json`, {
    headers: { accept: "application/json" },
  }).then((response) => {
    if (!response.ok) throw new Error(`index ${response.status}`);
    return response.json() as Promise<ResearchIndex>;
  });
}

/**
 * One fetch per page load, shared by the panel and the header menu. A failed
 * attempt is forgotten so the next hover can try again.
 */
let indexRequest: Promise<ResearchIndex> | null = null;
export function loadIndex(): Promise<ResearchIndex> {
  indexRequest ??= readResearchIndex().catch((error) => {
    indexRequest = null;
    throw error;
  });
  return indexRequest;
}

export function readTopic(id: string): Promise<TopicDetail> {
  return fetch(`${base()}research/topics/${encodeURIComponent(id)}.json`, {
    headers: { accept: "application/json" },
  }).then((response) => {
    if (!response.ok) throw new Error(`topic ${response.status}`);
    return response.json() as Promise<TopicDetail>;
  });
}

/* ---------- the research panel on the deck ---------- */

let notes: HTMLElement | null = null;
let index: ResearchIndex | null = null;

export async function mountResearchNotes(root: HTMLElement) {
  notes = root;
  try {
    const payload = await loadIndex();
    if (!payload.topics?.length) throw new Error("empty index");
    index = payload;
    paintNotes();
  } catch {
    // Keep the static copy that shipped in the HTML. Marking it makes the
    // difference visible to the check script and to anyone reading the DOM.
    root.dataset.research = "fallback";
  }
}

/** Called when the language switches; the cards carry both languages inline. */
export function refreshResearchNotes() {
  if (notes && index) paintNotes();
}

const SHOWN = 4;

function paintNotes() {
  if (!notes || !index) return;
  const language = currentLanguage();
  const taxonomy = index.taxonomy;
  const fragment = document.createDocumentFragment();

  for (const topic of index.topics.slice(0, SHOWN)) {
    const card = document.createElement("article");
    card.className = "note";
    card.dataset.topic = topic.id;

    const tag = document.createElement("p");
    tag.className = "note-tag";
    tag.textContent = facets(topic, language, taxonomy);
    const date = document.createElement("span");
    date.className = "note-date";
    date.textContent = topic.updated;
    tag.append(date);

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = topicUrl(topic.id, language);
    link.textContent = pick(topic.title, language);
    title.append(link);

    const summary = document.createElement("p");
    summary.textContent = pick(topic.summary, language);

    const more = document.createElement("a");
    more.className = "note-link";
    more.href = topicUrl(topic.id, language);
    const label = document.createElement("span");
    label.textContent = `${kindLabel(topic, language, taxonomy)} · ${
      language === "en" ? "Read" : "读这条"
    }`;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    more.append(label, arrow);

    card.append(tag, title, summary, more);
    fragment.append(card);
  }

  // The panel is a shop window, not the shelf. Past a handful of entries the
  // list stops being readable and starts being a scrollbar, so it hands the
  // rest to the library page.
  if (index.topics.length > 1) {
    const more = document.createElement("a");
    more.className = "notes-more";
    more.href = libraryUrl({}, language);
    more.textContent =
      language === "en"
        ? `All ${index.topics.length} entries`
        : `全部 ${index.topics.length} 条`;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    more.append(arrow);
    fragment.append(more);
  }

  notes.replaceChildren(fragment);
  notes.dataset.research = "loaded";
  notes.dataset.count = String(index.topics.length);
  notes.dataset.shown = String(Math.min(SHOWN, index.topics.length));
}
