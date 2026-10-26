/**
 * Just enough Markdown for the research notes.
 *
 * The supported set is small on purpose: headings, paragraphs, lists, tables,
 * fenced code, inline code, bold, links, blockquotes, rules. Anything else is
 * printed as written, which is the honest outcome for a reader who expects the
 * text to be what it says. Every block runs through `escapeHtml` first, so a
 * note that contains markup renders it as text instead of executing it.
 */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  );

const URL_OK = /^(https?:\/\/|mailto:|\/|#|\.)/;
const EXTERNAL = /^https?:\/\//;

function inline(text: string): string {
  // Inline code goes out first, into placeholders, so `**` inside a code span
  // is not read as bold. Placeholder uses a character HTML never contains.
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const target = URL_OK.test(href) ? href : "#";
    const external = EXTERNAL.test(target) ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${target}"${external}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codes[Number(index)]);
  return out;
}

const isBlockStart = (line: string) =>
  /^(#{1,4}\s|```|>\s|[-*]\s|\d+\.\s|\|)/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line);

function table(lines: string[]): string {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const numeric = (value: string) => /^[-+]?[\d.,]+\s*[a-zA-Z%]*$/.test(value) && /\d/.test(value);
  const headHtml = head
    .map((cell) => `<th${numeric(cell) ? ' class="num"' : ""}>${inline(cell)}</th>`)
    .join("");
  const bodyHtml = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td${numeric(cell) ? ' class="num"' : ""}>${inline(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

export interface MarkdownOptions {
  /** The page already prints the title, so the first `#` line is redundant. */
  dropFirstHeading?: boolean;
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let dropHeading = options.dropFirstHeading ?? false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      const language = fence[1] ? ` data-language="${fence[1]}"` : "";
      out.push(`<pre${language}><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      i += 1;
      if (level === 1 && dropHeading) {
        dropHeading = false;
        continue;
      }
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (line.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) block.push(lines[i++]);
      out.push(table(block));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(block.join("\n"))}</blockquote>`);
      continue;
    }

    const list = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        let text = item[3];
        i += 1;
        // A wrapped line continues the item until a blank line or a new bullet.
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
          !isBlockStart(lines[i].trim())
        ) {
          text += ` ${lines[i].trim()}`;
          i += 1;
        }
        items.push(`<li>${inline(text)}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim())) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}
