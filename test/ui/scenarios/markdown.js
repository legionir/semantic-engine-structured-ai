"use strict";

/*
| Safe markdown: what model output can and cannot become
|
| Runs inside reactive.test.js once the browser globals exist. Model output
| is untrusted, so these tests feed markdown.js the inputs an attacker
| would and read back the real DOM Preact produced: no element, attribute
| or link target may come from the text except the ones markdown.js names.
*/

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const harness = require("../harness");

const APP = path.join(harness.PUBLIC_DIR, "app");


module.exports = async function SafeMarkdown({ test }) {

    const md = await import(pathToFileURL(path.join(APP, "markdown.js")).href);
    const preact = await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "vendor", "preact.module.js")).href);

    /* the real component, rendered into a detached element */
    const draw = text => {
        const host = document.createElement("div");
        preact.render(preact.h(md.Markdown, { text }), host);
        return host.firstElementChild;
    };

    const tags = root => [...root.querySelectorAll("*")].map(node => node.tagName.toLowerCase());

    await test("only http(s), mailto, fragments and relative paths survive as link targets", () => {

        for (const unsafe of [
            "javascript:alert(1)",
            "  JaVaScRiPt:alert(1)",
            "java\tscript:alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "//evil.example/steal",
            "http://[not a host"
        ]) {
            assert.equal(md.safeMarkdownHref(unsafe), null, `${JSON.stringify(unsafe)} must be refused`);
        }

        assert.equal(md.safeMarkdownHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
        assert.equal(md.safeMarkdownHref("HTTP://Example.com"), "http://example.com/");
        assert.equal(md.safeMarkdownHref("mailto:ops@example.com"), "mailto:ops@example.com");
        for (const kept of ["#section", "/docs/a.md", "./a.md", "../b.md", ""]) {
            assert.equal(md.safeMarkdownHref(kept), kept);
        }
        assert.equal(md.safeMarkdownHref(null), "");
    });

    await test("a refused link stays literal text and never becomes an anchor", () => {

        const root = draw("see [click me](javascript:alert(document.cookie)) and [ok](https://example.com)");
        const anchors = [...root.querySelectorAll("a")];

        assert.equal(anchors.length, 1, "only the safe link is an anchor");
        assert.equal(anchors[0].getAttribute("href"), "https://example.com/");
        assert.equal(anchors[0].getAttribute("target"), "_blank");
        assert.equal(anchors[0].getAttribute("rel"), "noopener noreferrer");
        assert.match(root.textContent, /\[click me\]\(javascript:alert\(document\.cookie\)/);
    });

    await test("HTML in model output is shown as text, never parsed into elements", () => {

        const payload = "<img src=x onerror=alert(1)> <script>alert(2)</script> <a href=\"javascript:x\">a</a>";
        const root = draw(`${payload}\n\n# <b>title</b>\n\n- <iframe src="https://evil.example"></iframe>`);

        assert.deepEqual(
            tags(root).filter(tag => ["img", "script", "a", "b", "iframe"].includes(tag)),
            [],
            "no element came from the text"
        );
        assert.ok(root.textContent.includes(payload), "the markup is visible as written");
        assert.ok(
            [...root.querySelectorAll("*")].every(node =>
                [...node.attributes].every(attr => !/^on/i.test(attr.name))
            ),
            "no event handler attribute exists anywhere"
        );
    });

    await test("inline runs: code, both strong forms, strikethrough and both emphasis forms", () => {

        const root = draw("`a**b**` **bold** __also bold__ ~~gone~~ *soft* _quiet_ snake_case_name");
        const paragraph = root.querySelector("p.md-paragraph");

        assert.equal(paragraph.querySelector("code.inline-code").textContent, "a**b**", "code is not parsed further");
        assert.deepEqual([...paragraph.querySelectorAll("strong")].map(n => n.textContent), ["bold", "also bold"]);
        assert.equal(paragraph.querySelector("del").textContent, "gone");
        assert.deepEqual([...paragraph.querySelectorAll("em")].map(n => n.textContent), ["soft", "quiet"]);
        assert.match(paragraph.textContent, /snake_case_name/, "underscores inside a word are not emphasis");
        assert.equal(paragraph.querySelectorAll("em").length, 2);
    });

    await test("delimiters nest across kinds, and unclosed or hostile runs end as text quickly", () => {

        assert.equal(draw("**never closed").textContent, "**never closed");

        /* the first closing delimiter wins, so nesting only happens across kinds */
        const nested = draw("**a __b ~~c *d _e [f](https://example.com)_*~~__**");
        const link = nested.querySelector("strong strong del em em a");
        assert.ok(link, "every kind nests inside the previous one");
        assert.equal(link.textContent, "f");

        const started = Date.now();
        const hostile = draw(`${"[a](".repeat(20000)} \`x ~~y **z`);
        assert.ok(Date.now() - started < 2000, "a long run of unclosed openers does not stall the page");
        assert.equal(hostile.querySelectorAll("a, code, del, strong").length, 0, "nothing unclosed becomes an element");
    });

    await test("fenced code keeps its text verbatim, names its language and survives a missing fence", () => {

        const root = draw("```js\nconst a = \"<b>\" ** 2;\n# not a heading\n```\n\n~~~\nplain\n~~~\n\n```\nunterminated");
        const blocks = [...root.querySelectorAll("pre.md-code-block")];

        assert.equal(blocks.length, 3);
        assert.equal(blocks[0].querySelector("code").className, "language-js");
        assert.equal(blocks[0].textContent, "const a = \"<b>\" ** 2;\n# not a heading");
        assert.equal(root.querySelectorAll("h1, b, strong").length, 0, "nothing inside a fence is parsed");
        assert.equal(blocks[1].querySelector("code").getAttribute("class"), null, "no language, no class");
        assert.equal(blocks[1].textContent, "plain");
        assert.equal(blocks[2].textContent, "unterminated");
    });

    await test("tables, rules, quotes and both list kinds produce the console's element structure", () => {

        const root = draw([
            "| file | lines |",
            "| :--- | ---: |",
            "| a.js | **12** |",
            "| b.js |",
            "",
            "---",
            "",
            "> quoted *text*",
            "> - inside",
            "",
            "1. first",
            "2) second",
            "- bullet"
        ].join("\n"));

        const table = root.querySelector("table.md-table");
        assert.deepEqual([...table.querySelectorAll("th")].map(n => n.textContent), ["file", "lines"]);
        assert.deepEqual(
            [...table.querySelectorAll("tbody tr")].map(row => [...row.children].map(n => n.textContent)),
            [["a.js", "12"], ["b.js", ""]],
            "a short row is padded to the header width"
        );
        assert.ok(table.querySelector("td strong"), "cells take inline markdown");

        assert.ok(root.querySelector("hr"));

        const quote = root.querySelector("blockquote.md-quote");
        assert.ok(quote.querySelector("em"), "a quote is markdown again");
        assert.ok(quote.querySelector("ul.md-list li"));

        const lists = [...root.children].filter(n => n.matches("ol, ul"));
        assert.deepEqual(lists.map(n => n.tagName), ["OL", "UL"], "an ordered run ends where bullets start");
        assert.deepEqual([...lists[0].children].map(n => n.textContent), ["first", "second"]);
    });

    await test("a paragraph keeps line breaks and stops where another block starts", () => {

        const root = draw("line one\nline two\n# Heading #\nafter\r\n> quote");
        const children = [...root.children].map(n => n.tagName);

        assert.deepEqual(children, ["P", "H1", "P", "BLOCKQUOTE"]);
        assert.equal(root.querySelector("p").querySelectorAll("br").length, 1);
        assert.equal(root.querySelector("h1").textContent, "Heading", "closing hashes are trimmed");
        assert.equal(draw("   \n\n").children.length, 0, "blank text draws nothing");
        assert.equal(md.markdownParagraph(["a", "b"]).props.class, "md-paragraph");
    });
};
