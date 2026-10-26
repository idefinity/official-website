/**
 * The shelf: every entry, filterable and searchable.
 *
 * This is what `research.html` paints when the URL has no `?id`. It is also the
 * answer to "what happens when there are sixty entries": the deck panel stops
 * being the only way in, and the list gets tools instead of getting long.
 *
 * All the filtering is local — the index is a few kilobytes — so typing feels
 * instant and nothing is fetched per keystroke.
 */
import {
  facets,
  nameFor,
  pick,
  topicUrl,
  type Language,
  type ResearchIndex,
  type TopicSummary,
} from "./research.ts";

const COPY = {
  zh: {
    kicker: "研究台账",
    title: "每个问题，按时间排。",
    lead: (entries: number, tracks: number) =>
      `${entries} 条记录，分在 ${tracks} 个方向里。点标题进正文。`,
    search: "搜标题、问题、标签",
    searchLabel: "搜索研究记录",
    all: "全部",
    count: (shown: number, total: number) => `${shown} / ${total}`,
    empty: "没有匹配的记录。清掉关键词，或者换个方向。",
    clear: "清掉",
    when: "更新",
  },
  en: {
    kicker: "Research ledger",
    title: "Every question, newest first.",
    lead: (entries: number, tracks: number) =>
      `${entries} entries across ${tracks} directions. Open a title to read it.`,
    search: "Search titles, questions, tags",
    searchLabel: "Search research entries",
    all: "All",
    count: (shown: number, total: number) => `${shown} / ${total}`,
    empty: "Nothing matches. Clear the search or pick a different direction.",
    clear: "Clear",
    when: "Updated",
  },
} as const;

interface LibraryState {
  track: string | null;
  query: string;
}

/** Words that appear anywhere in the entry, in either language. */
function haystack(topic: TopicSummary, index: ResearchIndex): string {
  const taxonomy = index.taxonomy;
  return [
    topic.id,
    topic.title.zh,
    topic.title.en ?? "",
    topic.summary.zh,
    topic.summary.en ?? "",
    ...topic.tags,
    ...(topic.questions?.zh ?? []),
    ...(topic.questions?.en ?? []),
    nameFor(taxonomy, "tracks", topic.track, "zh"),
    nameFor(taxonomy, "tracks", topic.track, "en"),
    nameFor(taxonomy, "statuses", topic.status, "zh"),
    nameFor(taxonomy, "statuses", topic.status, "en"),
    ...(topic.series ?? []).map((id) => nameFor(taxonomy, "series", id, "zh")),
    ...(topic.series ?? []).map((id) => nameFor(taxonomy, "series", id, "en")),
  ]
    .join(" ")
    .toLowerCase();
}

export function paintLibrary(
  root: HTMLElement,
  index: ResearchIndex,
  language: Language,
  initial: { track?: string | null; query?: string | null },
) {
  const text = COPY[language];
  const taxonomy = index.taxonomy;
  const topics = index.topics;
  const known = new Set(topics.map((topic) => topic.track));

  // Only offer the directions that actually hold something. An empty filter is
  // a dead end, and with sixty entries most of them will be empty at some point.
  const tracks = (taxonomy?.tracks ?? [])
    .filter((entry) => known.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label: pick(entry, language),
      count: topics.filter((topic) => topic.track === entry.id).length,
    }));

  const state: LibraryState = {
    track: tracks.some((entry) => entry.id === initial.track) ? (initial.track ?? null) : null,
    query: initial.query ?? "",
  };

  const section = document.createElement("section");
  section.className = "library";

  const kicker = document.createElement("p");
  kicker.className = "article-kicker";
  kicker.textContent = text.kicker;

  const title = document.createElement("h1");
  title.textContent = text.title;

  const lead = document.createElement("p");
  lead.className = "article-lead";
  lead.textContent = text.lead(topics.length, tracks.length);

  const tools = document.createElement("div");
  tools.className = "library-tools";

  const field = document.createElement("label");
  field.className = "library-field";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "library-search";
  input.placeholder = text.search;
  input.setAttribute("aria-label", text.searchLabel);
  input.value = state.query;
  input.spellcheck = false;
  field.append(input);

  const filters = document.createElement("div");
  filters.className = "library-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", text.all);

  const chips: HTMLButtonElement[] = [];
  const makeChip = (id: string | null, label: string, count: number) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-chip";
    button.dataset.track = id ?? "";
    const name = document.createElement("span");
    name.textContent = label;
    const tally = document.createElement("span");
    tally.className = "library-chip-count";
    tally.textContent = String(count);
    button.append(name, tally);
    button.addEventListener("click", () => {
      state.track = id;
      render();
    });
    chips.push(button);
    filters.append(button);
  };
  makeChip(null, text.all, topics.length);
  for (const track of tracks) makeChip(track.id, track.label, track.count);

  tools.append(field, filters);

  const status = document.createElement("p");
  status.className = "library-count";
  status.setAttribute("aria-live", "polite");

  const list = document.createElement("ol");
  list.className = "library-list";

  const empty = document.createElement("p");
  empty.className = "library-empty";
  empty.textContent = text.empty;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "library-clear";
  clear.textContent = text.clear;
  clear.addEventListener("click", () => {
    state.query = "";
    state.track = null;
    input.value = "";
    render();
    input.focus();
  });
  empty.append(clear);

  section.append(kicker, title, lead, tools, status, list, empty);
  root.replaceChildren(section);
  root.classList.add("library-body");
  root.dataset.state = "library";

  input.addEventListener("input", () => {
    state.query = input.value;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      state.query = "";
      input.value = "";
      render();
    }
  });

  function matches(topic: TopicSummary): boolean {
    if (state.track && topic.track !== state.track) return false;
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = haystack(topic, index);
    return words.every((word) => hay.includes(word));
  }

  function render() {
    for (const chip of chips) {
      const active = (chip.dataset.track || null) === state.track;
      chip.setAttribute("aria-pressed", String(active));
    }

    const visible = topics.filter(matches);
    const fragment = document.createDocumentFragment();
    for (const topic of visible) fragment.append(row(topic));
    list.replaceChildren(fragment);

    status.textContent = text.count(visible.length, topics.length);
    empty.hidden = visible.length > 0;
    list.hidden = visible.length === 0;
    syncUrl();
  }

  function row(topic: TopicSummary): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "library-row";

    const link = document.createElement("a");
    link.className = "library-link";
    link.href = topicUrl(topic.id, language);

    const when = document.createElement("span");
    when.className = "library-when";
    when.textContent = topic.updated;

    const main = document.createElement("span");
    main.className = "library-main";
    const heading = document.createElement("span");
    heading.className = "library-title";
    heading.textContent = pick(topic.title, language);
    const summary = document.createElement("span");
    summary.className = "library-summary";
    summary.textContent = pick(topic.summary, language);
    main.append(heading, summary);

    const meta = document.createElement("span");
    meta.className = "library-meta";
    const facet = document.createElement("span");
    facet.className = "library-facet";
    facet.textContent = facets(topic, language, taxonomy);
    meta.append(facet);
    for (const id of topic.series ?? []) {
      const series = document.createElement("span");
      series.className = "library-series";
      series.textContent = nameFor(taxonomy, "series", id, language);
      meta.append(series);
    }

    link.append(when, main, meta);
    item.append(link);
    return item;
  }

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("id");
    if (state.track) url.searchParams.set("track", state.track);
    else url.searchParams.delete("track");
    const query = state.query.trim();
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  }

  render();
}
