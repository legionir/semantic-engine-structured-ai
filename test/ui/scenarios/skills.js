"use strict";

/*
| ui.test.js: the Skills panel and the /skill command
|
| The header menu's Skills button opens every skill (GET /api/skills):
| search, filter, the sent-to-the-AI switch (PUT /api/skills/prompt) and
| reset. "/skill " in the composer completes a skill name, and sending
| "/skill <name> <message>" posts it as the task, where the runtime
| attaches the skill.
*/

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const harness = require("../harness");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


function listing(enabledExtra = false) {

    const skills = [
        { name: "git", description: "Version control: commits, branches.", origin: "registry", format: "registry", recommended: false, default_enabled: true, prompt_enabled: true },
        { name: "forensic-security-threat-audit", description: "Forensic, evidence-only security audit of a software system: threats and controls.", origin: "library", library: "persona", kind: "role", format: "SKILL.md", recommended: true, default_enabled: true, prompt_enabled: true },
        { name: "accessibility-wcag-audit", description: "Evidence-based accessibility audit against WCAG 2.2.", origin: "library", library: "persona", kind: "role", format: "SKILL.md", recommended: false, default_enabled: false, prompt_enabled: enabledExtra }
    ];

    return {
        skills,
        libraries: [{ name: "persona", title: "Persona", license: "Apache-2.0", source: null, skills: 2, recommended: ["forensic-security-threat-audit"] }],
        prompt: { enabled: skills.filter(skill => skill.prompt_enabled).length, index_chars: 420, max_chars: 3000, names_only: 0 }
    };
}


module.exports = async function skillsCases({ test, backdrops, console_ }) {

    const skills = await import(pathToFileURL(path.join(harness.PUBLIC_DIR, "app", "skills-controller.js")).href);

    await test("skills rank by name prefix, then name, then description", async () => {

        const { skills: list } = listing();
        assert.deepEqual(skills.rankSkills(list, "a").map(skill => skill.name)[0], "accessibility-wcag-audit");
        assert.deepEqual(skills.rankSkills(list, "audit").map(skill => skill.name), ["accessibility-wcag-audit", "forensic-security-threat-audit"]);
        assert.deepEqual(skills.rankSkills(list, "commits").map(skill => skill.name), ["git"]);
        assert.deepEqual(skills.rankSkills(list, "").map(skill => skill.name), ["forensic-security-threat-audit", "git", "accessibility-wcag-audit"], "with no query the skills sent to the AI come first");
    });

    await test("the Skills panel lists every skill, switches one on for the AI and resets", async () => {

        console_.reply("/api/skills", listing());
        console_.reply("PUT /api/skills/prompt", { name: "accessibility-wcag-audit", prompt_enabled: true });
        console_.reply("POST /api/skills/prompt/reset", { reset: true });

        const button = document.getElementById("skillsButton");
        assert.ok(button.closest("#consoleMenu .bar-nav"), "Skills lives in the header menu");

        button.dispatch("click");
        await sleep(20);

        const dialog = () => document.querySelector(".modal.skills-modal");
        assert.ok(dialog(), "the Skills panel opened");
        assert.match(dialog().textContent, /2 of 3 skills sent to the AI/);
        assert.equal(dialog().querySelectorAll(".skill-row").length, 3);

        const row = name => dialog().querySelector(`.skill-row[data-skill="${name}"]`);
        assert.match(row("forensic-security-threat-audit").textContent, /recommended/);
        assert.match(row("forensic-security-threat-audit").textContent, /persona/);

        /* search and filter */
        const search = dialog().querySelector(".skills-search");
        search.value = "wcag";
        search.dispatch("input");
        assert.deepEqual([...dialog().querySelectorAll(".skill-row")].map(item => item.dataset.skill), ["accessibility-wcag-audit"]);
        search.value = "";
        search.dispatch("input");

        const filter = dialog().querySelector(".skills-filter");
        filter.value = "enabled";
        filter.dispatch("change");
        assert.equal(dialog().querySelectorAll(".skill-row").length, 2);
        filter.value = "all";
        filter.dispatch("change");

        /* switch a library skill on */
        console_.reply("/api/skills", listing(true));
        const box = row("accessibility-wcag-audit").querySelector(".skill-enabled");
        box.checked = true;
        box.dispatch("change");
        await sleep(20);

        const put = console_.posted.filter(item => item.url === "/api/skills/prompt" && item.method === "PUT").pop();
        assert.deepEqual(put.body, { name: "accessibility-wcag-audit", enabled: true });
        assert.match(dialog().textContent, /3 of 3 skills sent to the AI/);
        assert.match(dialog().querySelector(".skills-msg").textContent, /is sent to the AI/);

        /* a scoped token is refused: the switch goes back */
        console_.reply("PUT /api/skills/prompt", { __status: 403, body: { error: "admin only" } });
        const gitBox = row("git").querySelector(".skill-enabled");
        gitBox.checked = false;
        gitBox.dispatch("change");
        await sleep(20);
        assert.equal(gitBox.checked, true);
        assert.match(dialog().querySelector(".skills-msg").textContent, /admin token/);

        /* reset */
        console_.reply("/api/skills", listing());
        dialog().querySelector(".skills-reset-btn").dispatch("click");
        await sleep(20);
        assert.ok(console_.posted.some(item => item.url === "/api/skills/prompt/reset" && item.method === "POST"));
        assert.match(dialog().textContent, /2 of 3 skills sent to the AI/);

        /* Use puts /skill <name> in the composer and closes the panel */
        row("accessibility-wcag-audit").querySelector(".skill-use-btn").dispatch("click");
        await sleep(10);
        assert.equal(dialog(), null);
        assert.equal(document.getElementById("task").value, "/skill accessibility-wcag-audit ");
        assert.equal(backdrops().length, 0);
        document.getElementById("task").value = "";
    });

    await test("/skill completes a skill name and sends the message with it as the task", async () => {

        console_.reply("/api/skills", listing());
        skills.skillsActions.cache.data = null;

        const task = document.getElementById("task");
        const form = document.getElementById("taskForm");
        const list = document.getElementById("mentionList");

        /* "/ski" offers the command; choosing it goes straight on to the skills */
        task.value = "/ski";
        task.selectionStart = task.selectionEnd = task.value.length;
        task.dispatch("input");
        await sleep(150);
        const command = [...list.querySelectorAll("li")].find(item => item.textContent.startsWith("/skill"));
        assert.ok(command, "/skill is offered");
        command.dispatch("mousedown");
        await sleep(150);
        assert.equal(task.value, "/skill ");
        assert.equal(list.hidden, false);
        assert.match(list.textContent, /forensic-security-threat-audit/);

        /* "/skill acc" lists matching skills */
        task.value = "/skill acc";
        task.selectionStart = task.selectionEnd = task.value.length;
        task.dispatch("input");
        await sleep(150);
        assert.equal(list.hidden, false);
        assert.match(list.textContent, /accessibility-wcag-audit/);
        assert.doesNotMatch(list.textContent, /git/);

        /* choosing it completes the name and leaves the caret for the message */
        list.querySelector("li, .mention-item, button").dispatch("mousedown");
        await sleep(10);
        assert.equal(task.value, "/skill accessibility-wcag-audit ");

        /* sending posts the whole line as the task */
        task.value = "/skill accessibility-wcag-audit check the\nlogin page";
        const before = console_.posted.filter(item => item.url.endsWith("/tasks")).length;
        form.dispatch("submit");
        await sleep(30);
        const posts = console_.posted.filter(item => item.url.endsWith("/tasks"));
        assert.equal(posts.length, before + 1);
        assert.equal(posts[posts.length - 1].body.task, "/skill accessibility-wcag-audit check the\nlogin page");

        /* an unknown name stays in the composer with an error, nothing is sent */
        task.value = "/skill nope do it";
        form.dispatch("submit");
        await sleep(30);
        assert.equal(console_.posted.filter(item => item.url.endsWith("/tasks")).length, before + 1);
        assert.equal(task.value, "/skill nope do it");

        /* "/skill" alone opens the panel */
        task.value = "/skill";
        form.dispatch("submit");
        await sleep(30);
        assert.ok(document.querySelector(".modal.skills-modal"));
        document.querySelector(".modal.skills-modal .modal-close").dispatch("click");
        task.value = "";
    });
};
