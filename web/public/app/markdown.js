/*
|--------------------------------------------------------------------------
| Safe markdown
|--------------------------------------------------------------------------
|
| Model output is untrusted. It is turned into Preact vnodes, never into an
| HTML string: every piece of text becomes a text node, and a link survives
| only if its target is http(s), mailto, a fragment or a relative path.
| Anything else is shown as the literal markdown it was written as.
|
| The element structure (span runs, p.md-paragraph, pre.md-code-block,
| table.md-table, blockquote.md-quote, ul/ol.md-list, hN.md-heading) is the
| one the console has always produced; app.css styles exactly these.
|--------------------------------------------------------------------------
*/

import { h } from "../vendor/preact.module.js";


export function safeMarkdownHref(value) {

    const href = String(value ?? "").trim();

    if (href.startsWith("//")) {
        return null;
    }

    if (
        href === "" ||
        href.startsWith("#") ||
        href.startsWith("/") ||
        href.startsWith("./") ||
        href.startsWith("../")
    ) {
        return href;
    }

    try {

        const base =
            typeof window !== "undefined" && window.location && window.location.href
                ? window.location.href
                : "https://structured-ai.invalid/";

        const parsed = new URL(href, base);

        return ["http:", "https:", "mailto:"].includes(parsed.protocol)
            ? parsed.href
            : null;

    } catch {
        return null;
    }
}


/* inline runs: `code`, **strong**, __strong__, ~~del~~, *em*, _em_, [link](url) */
export function inlineMarkdown(value, depth = 0) {

    const text = String(value ?? "");
    const out = [];

    /* a depth limit keeps malformed nested delimiters from recursing forever */
    if (depth > 8 || text === "") {
        if (text !== "") out.push(h("span", null, text));
        return out;
    }

    let index = 0;
    let plainStart = 0;

    const flushPlain = end => {
        if (end > plainStart) {
            out.push(h("span", null, text.slice(plainStart, end)));
        }
    };

    const findClosing = (delimiter, from) => {
        if (delimiter === "`") {
            const closing = text.indexOf("`", from);
            return closing > from ? closing : -1;
        }
        const doubleDelim = delimiter.length === 1 ? delimiter + delimiter : null;
        let pos = from;
        let noMoreBacktick = false;
        let noMoreDouble = false;
        let noMoreLink = false;

        const findCodeEnd = start => {
            if (noMoreBacktick) return -1;
            const codeClose = text.indexOf("`", start + 1);
            if (codeClose === -1) {
                noMoreBacktick = true;
                return -1;
            }
            return codeClose + 1;
        };

        const findDoubleEnd = start => {
            if (noMoreDouble) return -1;
            let scan = start + 2;
            while (scan < text.length) {
                if (text[scan] === "`" && !noMoreBacktick) {
                    const nextScan = findCodeEnd(scan);
                    if (nextScan !== -1) {
                        scan = nextScan;
                        continue;
                    }
                }
                if (text.startsWith(doubleDelim, scan)) {
                    return scan + 2;
                }
                scan++;
            }
            noMoreDouble = true;
            return -1;
        };

        while (pos < text.length) {
            if (text[pos] === "`" && !noMoreBacktick) {
                const nextPos = findCodeEnd(pos);
                if (nextPos !== -1) {
                    pos = nextPos;
                    continue;
                }
            }
            if (text[pos] === "[" && !noMoreLink) {
                const labelEnd = text.indexOf("](", pos + 1);
                const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);
                if (labelEnd > pos && urlEnd > labelEnd) {
                    if (safeMarkdownHref(text.slice(labelEnd + 2, urlEnd)) !== null) {
                        pos = urlEnd + 1;
                        continue;
                    }
                } else {
                    noMoreLink = true;
                }
            }
            if (doubleDelim && text.startsWith(doubleDelim, pos)) {
                const nextPos = findDoubleEnd(pos);
                if (nextPos !== -1) {
                    pos = nextPos;
                    continue;
                }
            }
            if (text.startsWith(delimiter, pos)) {
                return pos > from ? pos : -1;
            }
            pos++;
        }
        return -1;
    };

    while (index < text.length) {

        let delimiter = null;
        let closing = -1;
        let tag = null;

        if (text[index] === "`") {
            delimiter = "`";
            closing = findClosing(delimiter, index + 1);
            tag = "code";
        } else if (text.startsWith("**", index)) {
            delimiter = "**";
            closing = findClosing(delimiter, index + 2);
            tag = "strong";
        } else if (text.startsWith("__", index)) {
            delimiter = "__";
            closing = findClosing(delimiter, index + 2);
            tag = "strong";
        } else if (text.startsWith("~~", index)) {
            delimiter = "~~";
            closing = findClosing(delimiter, index + 2);
            tag = "del";
        } else if (
            (text[index] === "*" || text[index] === "_") &&
            (index === 0 || /\s/.test(text[index - 1] || ""))
        ) {
            delimiter = text[index];
            closing = findClosing(delimiter, index + 1);
            tag = "em";
        }

        if (text[index] === "[") {

            const labelEnd = text.indexOf("](", index + 1);
            const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);

            if (labelEnd > index && urlEnd > labelEnd) {

                const href = safeMarkdownHref(text.slice(labelEnd + 2, urlEnd));

                if (href !== null) {
                    flushPlain(index);
                    out.push(
                        h(
                            "a",
                            { href, target: "_blank", rel: "noopener noreferrer" },
                            inlineMarkdown(text.slice(index + 1, labelEnd), depth + 1)
                        )
                    );
                    index = urlEnd + 1;
                    plainStart = index;
                    continue;
                }
            }
        }

        if (tag && closing !== -1) {

            flushPlain(index);

            const inner = text.slice(index + delimiter.length, closing);

            out.push(
                tag === "code"
                    ? h("code", { class: "inline-code" }, inner)
                    : h(tag, null, inlineMarkdown(inner, depth + 1))
            );

            index = closing + delimiter.length;
            plainStart = index;
            continue;
        }

        index++;
    }

    flushPlain(text.length);

    return out;
}


function isBlockStart(line) {
    return (
        /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s{0,3}(?:`{3,}[^`\n]*|~{3,})/.test(line) ||
        /^\s{0,3}>/.test(line) ||
        /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
        /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
    );
}


function tableCells(line) {

    return String(line ?? "")
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cell => cell.trim());
}


function isTableSeparator(line) {

    const cells = tableCells(line);

    return cells.length > 0 && cells.every(cell => /^:?-{1,}:?$/.test(cell));
}


function table(headerLine, rows) {

    const headers = tableCells(headerLine);

    return h("table", { class: "md-table" },
        h("thead", null,
            h("tr", null, headers.map(cell => h("th", null, inlineMarkdown(cell))))
        ),
        h("tbody", null,
            rows.map(row => {
                const cells = tableCells(row);
                return h("tr", null,
                    headers.map((_, index) => h("td", null, inlineMarkdown(cells[index] || "")))
                );
            })
        )
    );
}


function paragraph(lines) {

    const children = [];

    lines.forEach((line, index) => {
        if (index > 0) children.push(h("br", null));
        children.push(...inlineMarkdown(line));
    });

    return h("p", { class: "md-paragraph" }, children);
}


const LIST_ITEM = /^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/;


/* block structure → array of vnodes */
export function markdownBlocks(value) {

    const markdown = String(value ?? "").replace(/\r\n?/g, "\n");
    const out = [];

    if (markdown.trim() === "") {
        return out;
    }

    const lines = markdown.split("\n");
    let index = 0;

    while (index < lines.length) {

        const line = lines[index];

        if (line.trim() === "") {
            index++;
            continue;
        }

        if (
            line.includes("|") &&
            index + 1 < lines.length &&
            isTableSeparator(lines[index + 1])
        ) {
            const rows = [];
            index += 2;

            while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
                rows.push(lines[index]);
                index++;
            }

            out.push(table(line, rows));
            continue;
        }

        const fence = /^\s{0,3}(?:(`{3,})\s*([^`\n]*?)|(~{3,})\s*([^\n]*?))\s*$/.exec(line);

        if (fence) {

            const marker = fence[1] || fence[3];
            const info = (fence[1] ? fence[2] : fence[4]) || "";
            const language = info.trim().split(/\s+/)[0] || "";
            const closeFence = new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`);
            const code = [];
            index++;

            while (index < lines.length && !closeFence.test(lines[index])) {
                code.push(lines[index]);
                index++;
            }

            if (index < lines.length) index++;

            out.push(
                h("pre", { class: "md-code-block" },
                    h("code", language ? { class: `language-${language}` } : null, code.join("\n"))
                )
            );
            continue;
        }

        const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

        if (heading) {
            out.push(h(`h${heading[1].length}`, { class: "md-heading" }, inlineMarkdown(heading[2])));
            index++;
            continue;
        }

        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            out.push(h("hr", null));
            index++;
            continue;
        }

        if (/^\s{0,3}>/.test(line)) {

            const quote = [];

            while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
                quote.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
                index++;
            }

            out.push(h("blockquote", { class: "md-quote" }, markdownBlocks(quote.join("\n"))));
            continue;
        }

        const listItem = LIST_ITEM.exec(line);

        if (listItem) {

            const ordered = /^\d/.test(listItem[1]);
            const items = [];

            while (index < lines.length) {
                const item = LIST_ITEM.exec(lines[index]);
                if (!item || /^\d/.test(item[1]) !== ordered) break;
                items.push(h("li", null, inlineMarkdown(item[2])));
                index++;
            }

            out.push(h(ordered ? "ol" : "ul", { class: "md-list" }, items));
            continue;
        }

        const paragraphLines = [line.trim()];
        index++;

        while (index < lines.length && lines[index].trim() !== "" && !isBlockStart(lines[index])) {
            paragraphLines.push(lines[index].trim());
            index++;
        }

        out.push(paragraph(paragraphLines));
    }

    return out;
}


/* <Markdown class="message-content" text=…/> */
export function Markdown({ text, class: className = "message-content" }) {

    return h("div", { class: className }, markdownBlocks(text));
}


/* one paragraph from the given lines (the discussion transcript uses this) */
export function markdownParagraph(lines) {

    return paragraph(lines);
}
