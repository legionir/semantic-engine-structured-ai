/*
|--------------------------------------------------------------------------
| Console markdown (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The console's own markdown renderer, and the safety rule under it: no HTML is
| ever injected. Everything is createElement + textContent, which is why
| `<img src=x onerror=…>` in a model answer draws as text; the test that pins that
| lives in test/ui.test.js and is the reason there is no innerHTML here.
|
| Links go through `safeMarkdownHref`, so `javascript:` and `data:` never become
| an href. Inline spans, fenced blocks and tables are the rest of the file.
|--------------------------------------------------------------------------
*/

import { node } from "./dom.js";

export function safeMarkdownHref(value) {

    const href = String(value ?? "").trim();

    if (href.startsWith("//")) {
        return null;
    }

    if (
        href === "" ||
        href.startsWith("#") ||
        (href.startsWith("/") && !href.startsWith("//")) ||
        href.startsWith("./") ||
        href.startsWith("../")
    ) {
        return href;
    }

    try {
        const baseUrl =
            typeof window !== "undefined" && window.location
                ? window.location.href
                : "http://localhost/";
        const parsed = new URL(href, baseUrl);

        return ["http:", "https:", "mailto:"].includes(parsed.protocol)
            ? parsed.href
            : null;
    } catch {
        return null;
    }
}

export function appendInlineMarkdown(parent, value, depth = 0) {

    const text = String(value ?? "");

    /* A depth limit prevents malformed nested delimiters from recursing
       forever while still supporting normal emphasis inside links/bold. */
    if (depth > 8 || text === "") {
        if (text !== "") parent.appendChild(node("span", null, text));
        return;
    }

    let index = 0;
    let plainStart = 0;

    const flushPlain = end => {
        if (end > plainStart) {
            parent.appendChild(node("span", null, text.slice(plainStart, end)));
        }
    };

    const findClosing = (delimiter, from) => {
        const closing = text.indexOf(delimiter, from);
        return closing > from ? closing : -1;
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

        /* Markdown links are parsed before ordinary text. Unsafe schemes are
           emitted as their literal markdown instead of becoming a link. */
        if (text[index] === "[") {
            const labelEnd = text.indexOf("](", index + 1);
            const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);

            if (labelEnd > index && urlEnd > labelEnd) {
                const href = safeMarkdownHref(text.slice(labelEnd + 2, urlEnd));

                if (href !== null) {
                    flushPlain(index);
                    const link = node("a");
                    link.href = href;
                    appendInlineMarkdown(
                        link,
                        text.slice(index + 1, labelEnd),
                        depth + 1
                    );
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    parent.appendChild(link);
                    index = urlEnd + 1;
                    plainStart = index;
                    continue;
                }
            }
        }

        if (tag && closing !== -1) {
            flushPlain(index);
            const element = node(tag, tag === "code" ? "inline-code" : null);
            const inner = text.slice(index + delimiter.length, closing);

            if (tag === "code") {
                element.textContent = inner;
            } else {
                appendInlineMarkdown(element, inner, depth + 1);
            }

            parent.appendChild(element);
            index = closing + delimiter.length;
            plainStart = index;
            continue;
        }

        index++;
    }

    flushPlain(text.length);
}

export function isMarkdownBlockStart(line) {
    return (
        /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s{0,3}(```|~~~)/.test(line) ||
        /^\s{0,3}>/.test(line) ||
        /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
        /^\s*(?:[-+*]|\d+[.)])\s+/.test(line)
    );
}

export function appendMarkdownParagraph(parent, lines) {

    const paragraph = node("p", "md-paragraph");

    lines.forEach((line, index) => {
        if (index > 0) paragraph.appendChild(node("br"));
        appendInlineMarkdown(paragraph, line);
    });

    parent.appendChild(paragraph);
}

export function markdownTableCells(line) {

    const normalized = String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "");
    return normalized.split("|").map(cell => cell.trim());
}

export function isMarkdownTableSeparator(line) {

    const cells = markdownTableCells(line);

    return (
        cells.length > 0 &&
        cells.every(cell => /^:?-{1,}:?$/.test(cell))
    );
}

export function appendMarkdownTable(parent, headerLine, rows) {

    const table = node("table", "md-table");
    const head = node("thead");
    const headRow = node("tr");

    for (const cell of markdownTableCells(headerLine)) {
        const th = node("th");
        appendInlineMarkdown(th, cell);
        headRow.appendChild(th);
    }

    head.appendChild(headRow);
    table.appendChild(head);

    const body = node("tbody");
    const headerCount = markdownTableCells(headerLine).length;

    for (const row of rows) {
        const tr = node("tr");
        const cells = markdownTableCells(row);

        for (let index = 0; index < headerCount; index++) {
            const td = node("td");
            appendInlineMarkdown(td, cells[index] || "");
            tr.appendChild(td);
        }

        body.appendChild(tr);
    }

    table.appendChild(body);
    parent.appendChild(table);
}

export function renderMarkdown(parent, value) {

    const markdown = String(value ?? "").replace(/\r\n?/g, "\n");
    parent.innerHTML = "";

    if (markdown.trim() === "") {
        return;
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
            isMarkdownTableSeparator(lines[index + 1])
        ) {
            const tableRows = [];
            index += 2;

            while (
                index < lines.length &&
                lines[index].trim() !== "" &&
                lines[index].includes("|")
            ) {
                tableRows.push(lines[index]);
                index++;
            }

            appendMarkdownTable(parent, line, tableRows);
            continue;
        }

        const fence = /^\s{0,3}(```|~~~)\s*([^\s]*)\s*$/.exec(line);

        if (fence) {
            const marker = fence[1];
            const language = fence[2] || "";
            const codeLines = [];
            index++;

            while (index < lines.length && !new RegExp(`^\\s{0,3}${marker}`).test(lines[index])) {
                codeLines.push(lines[index]);
                index++;
            }

            if (index < lines.length) index++;

            const pre = node("pre", "md-code-block");
            const code = node("code");
            if (language) code.className = `language-${language}`;
            code.textContent = codeLines.join("\n");
            pre.appendChild(code);
            parent.appendChild(pre);
            continue;
        }

        const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            const headingNode = node(`h${heading[1].length}`, "md-heading");
            appendInlineMarkdown(headingNode, heading[2]);
            parent.appendChild(headingNode);
            index++;
            continue;
        }

        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            parent.appendChild(node("hr"));
            index++;
            continue;
        }

        if (/^\s{0,3}>/.test(line)) {
            const quoteLines = [];
            while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
                index++;
            }
            const quote = node("blockquote", "md-quote");
            renderMarkdown(quote, quoteLines.join("\n"));
            parent.appendChild(quote);
            continue;
        }

        const listItem = /^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/.exec(line);
        if (listItem) {
            const ordered = /^\d/.test(listItem[1]);
            const list = node(ordered ? "ol" : "ul", "md-list");

            while (index < lines.length) {
                const item = /^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/.exec(lines[index]);
                if (!item || /^\d/.test(item[1]) !== ordered) break;

                const listEntry = node("li");
                appendInlineMarkdown(listEntry, item[2]);
                list.appendChild(listEntry);
                index++;
            }

            parent.appendChild(list);
            continue;
        }

        const paragraphLines = [line.trim()];
        index++;

        while (
            index < lines.length &&
            lines[index].trim() !== "" &&
            !isMarkdownBlockStart(lines[index])
        ) {
            paragraphLines.push(lines[index].trim());
            index++;
        }

        appendMarkdownParagraph(parent, paragraphLines);
    }
}
