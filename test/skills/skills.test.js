"use strict";

/*
|--------------------------------------------------------------------------
| Skills: the shipped library, which ones are sent to the AI, and /skill
|--------------------------------------------------------------------------
|
|   - SKILL.md front matter: YAML escapes, nested metadata
|   - agent/skill-library: every persona skill loads, the manifest's
|     recommended ones are marked, any other root wins a name
|   - the operator's choice of skills sent to the AI (skills-prompt.json)
|     and the index built from it: opening clauses, a budget past which
|     skills are listed by name only
|   - `/skill <name> [message]`: the complete skill rides with the message,
|     that request carries no skill index, the next ordinary turn does
|   - GET /api/skills, PUT /api/skills/prompt, POST /api/skills/prompt/reset
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { removeTempDirs } = require("../helpers/cleanup");

const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skills-")));
const WORKSPACE = path.join(TEMP, "ws");
const DATA_HOME = path.join(TEMP, "data");
const SCOPED = "scoped-token-skills";

fs.mkdirSync(WORKSPACE, { recursive: true });
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.STRUCTURED_AI_TRUST_FILE = path.join(TEMP, "trusted-workspaces.json");
process.env.PROCESS_SANDBOX_MODE = "test";
process.env.AGENT_APPROVAL = "auto";
process.env.AGENT_VERBOSE = "0";
process.env.AGENT_PRINT_FINAL = "0";
process.env.MAX_EMPTY_FINAL_NUDGES = "0";
process.env.AGENT_CONSOLE_TOKENS = JSON.stringify({
    [SCOPED]: { allowedProjects: ["prj-a"], permissions: ["project:read", "project:write"] }
});

const REPO = path.resolve(__dirname, "..", "..");
const settings = require(path.join(REPO, "agent", "config"));
const markdownSkills = require(path.join(REPO, "agent", "tools", "skills", "MarkdownSkills"));
const library = require(path.join(REPO, "agent", "tools", "skills", "SkillLibrary"));
const selection = require(path.join(REPO, "agent", "tools", "skills", "SkillSelection"));
const catalog = require(path.join(REPO, "agent", "tools", "skills", "SkillCatalog"));
const skillTools = require(path.join(REPO, "agent", "tools", "skills", "SkillTools"));
const { parseSkillCommand, attachSkill } = require(path.join(REPO, "agent", "tools", "skills", "SkillCommand"));
const { sectionType, syncSkillIndex } = require(path.join(REPO, "agent", "prompt", "SkillIndexMessage"));

const results = [];
const LIBRARY_SKILL = "forensic-security-threat-audit";
const OTHER_LIBRARY_SKILL = "accessibility-wcag-audit";


async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    }
}


function write(file, text) {

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}


/* an OpenAI-compatible endpoint that records every request and answers "done" */
function startStub() {

    const requests = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
        });
        req.on("end", () => {
            requests.push(JSON.parse(body));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                choices: [{
                    message: {
                        role: "assistant",
                        content: JSON.stringify({
                            version: "1.0",
                            action: "final",
                            tool_calls: null,
                            delegations: null,
                            data: null,
                            error: null,
                            response: { type: "text", content: "done" }
                        })
                    },
                    finish_reason: "stop"
                }]
            }));
        });
    });

    return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
        requests,
        port: server.address().port,
        close: () => new Promise(done => server.close(done))
    })));
}


const indexIn = messages => messages.filter(message => sectionType(message) === "available_skills");
const lastUser = messages => [...messages].reverse().find(message => message.role === "user");
const textOf = message => (typeof message.content === "string" ? message.content : JSON.stringify(message.content));


async function main() {

    await test("SKILL.md front matter unescapes YAML quotes and reads nested metadata", async () => {

        const { meta } = markdownSkills.parseFrontMatter([
            "---",
            "name: quoted",
            "description: \"Say \\\"hello\\\" to C:\\\\temp\\\\x\"",
            "title: 'it''s fine'",
            "metadata:",
            "  version: \"2.1\"",
            "  author: someone",
            "---",
            "Body"
        ].join("\n"));

        assert.equal(meta.description, "Say \"hello\" to C:\\temp\\x");
        assert.equal(meta.title, "it's fine");
        assert.deepEqual(meta.metadata, { version: "2.1", author: "someone" });
    });

    await test("every persona skill ships, with its library and recommendation", async () => {

        const [persona] = library.libraries();
        const manifest = JSON.parse(fs.readFileSync(path.join(library.LIBRARY_ROOT, "persona", "manifest.json"), "utf8"));

        assert.equal(persona.name, "persona");
        assert.equal(persona.license, "Apache-2.0");
        assert.equal(persona.skills.length, 218);
        assert.ok(fs.existsSync(path.join(library.LIBRARY_ROOT, "persona", "LICENSE")));

        const recommended = persona.skills.filter(skill => skill.recommended).map(skill => skill.name).sort();
        assert.deepEqual(recommended, [...manifest.recommended].sort());
        assert.equal(recommended.length, 12);

        for (const skill of persona.skills) {
            assert.equal(skill.origin, "library");
            assert.equal(skill.library, "persona");
            assert.equal(skill.format, "SKILL.md");
            assert.ok(skill.description.length > 20, `${skill.name} has a description`);
            assert.ok(!/\\"/.test(skill.description), `${skill.name}: no YAML escape is left in its description`);
        }
    });

    await test("every skill is listed; only recommended library skills and the runtime's own are sent to the AI", async () => {

        const all = catalog.listAllSkills();
        const names = all.map(skill => skill.name);

        assert.equal(new Set(names).size, names.length, "a name is listed once");
        assert.ok(names.includes("git") && names.includes(LIBRARY_SKILL) && names.includes(OTHER_LIBRARY_SKILL));

        for (const skill of all) {
            const expected = skill.origin === "library" ? skill.recommended : true;
            assert.equal(skill.prompt_enabled, expected, skill.name);
            assert.equal(skill.default_enabled, expected, skill.name);
        }

        const sent = skillTools._skillIndex().map(entry => entry.name);
        assert.ok(sent.includes(LIBRARY_SKILL) && sent.includes("git"));
        assert.ok(!sent.includes(OTHER_LIBRARY_SKILL));
    });

    await test("a project skill wins a library skill's name", async () => {

        write(path.join(WORKSPACE, ".agent", "skills", OTHER_LIBRARY_SKILL, "SKILL.md"),
            `---\nname: ${OTHER_LIBRARY_SKILL}\ndescription: The project's own accessibility checklist\n---\nUse our checklist.\n`);

        try {
            const skill = catalog.findSkill(OTHER_LIBRARY_SKILL);
            assert.equal(skill.origin, "project");
            assert.equal(catalog.listAllSkills().filter(item => item.name === OTHER_LIBRARY_SKILL).length, 1);
            assert.equal(catalog.listAllSkills().find(item => item.name === OTHER_LIBRARY_SKILL).prompt_enabled, true);
        } finally {
            fs.rmSync(path.join(WORKSPACE, ".agent"), { recursive: true, force: true });
        }
    });

    await test("the operator turns skills on and off for the AI, and reset restores the defaults", async () => {

        assert.equal(catalog.setSkillPromptEnabled(OTHER_LIBRARY_SKILL, true), true);
        assert.equal(catalog.setSkillPromptEnabled("git", false), false);

        const file = path.join(DATA_HOME, selection.FILE_NAME);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { enabled: [OTHER_LIBRARY_SKILL], disabled: ["git"] });

        const sent = skillTools._skillIndex().map(entry => entry.name);
        assert.ok(sent.includes(OTHER_LIBRARY_SKILL));
        assert.ok(!sent.includes("git"));

        /* back to the default: the override is dropped, not stored */
        catalog.setSkillPromptEnabled("git", true);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).disabled, []);

        assert.throws(() => catalog.setSkillPromptEnabled("no-such-skill", true), error => error.status === 404);

        catalog.resetPromptSelection();
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { enabled: [], disabled: [] });
        assert.ok(!skillTools._skillIndex().some(entry => entry.name === OTHER_LIBRARY_SKILL));
    });

    await test("the index carries opening clauses, and past its budget names only", async () => {

        const index = skillTools._skillIndex();
        const audit = index.find(entry => entry.name === LIBRARY_SKILL);

        assert.ok(audit.description.length <= settings.get("SKILL_INDEX_DESCRIPTION_CHARS"));
        assert.ok(!audit.description.includes("Use "), "the description is the opening clause, not the whole text");
        assert.ok(JSON.stringify(index).length <= settings.get("SKILL_INDEX_MAX_CHARS"));

        const before = settings.get("SKILL_INDEX_MAX_CHARS");
        settings.set("SKILL_INDEX_MAX_CHARS", 500);

        try {
            const tight = skillTools._skillIndex();
            assert.equal(tight.length, index.length, "every enabled skill is still listed");
            assert.ok(tight.some(entry => entry.description === undefined), "some are listed by name only");
            assert.ok(JSON.stringify(tight.filter(entry => entry.description !== undefined)).length <= 500);
        } finally {
            settings.set("SKILL_INDEX_MAX_CHARS", before);
        }
    });

    await test("/skill parses a name and a message that keeps its lines", async () => {

        assert.deepEqual(parseSkillCommand("/skill git commit this\nand that"), { name: "git", message: "commit this\nand that" });
        assert.deepEqual(parseSkillCommand("  /skill git"), { name: "git", message: "" });
        assert.deepEqual(parseSkillCommand("/skill"), { name: "", message: "" });
        assert.equal(parseSkillCommand("/skills git"), null);
        assert.equal(parseSkillCommand("use /skill git"), null);
        assert.equal(parseSkillCommand(undefined), null);
    });

    await test("/skill attaches the complete skill, for a library skill not sent to the AI too", async () => {

        const full = fs.readFileSync(path.join(library.LIBRARY_ROOT, "persona", OTHER_LIBRARY_SKILL, "SKILL.md"), "utf8");
        const body = markdownSkills.parseFrontMatter(full).body;

        const text = await attachSkill({ name: OTHER_LIBRARY_SKILL }, "check the login page", {});
        assert.ok(text.startsWith("check the login page\n"));
        assert.ok(text.includes(`<skill name="${OTHER_LIBRARY_SKILL}">`));
        assert.ok(text.includes(body.slice(-200)), "the end of the skill is there: nothing was cut");
        assert.match(text, /resources load with skill_read: references\//);

        const bare = await attachSkill({ name: "git" }, "", {});
        assert.match(bare, /^Apply the skill "git" below to this workspace\./);
        assert.match(bare, /## Instructions/);

        await assert.rejects(attachSkill({ name: "" }, "x", {}), /needs a skill name/);
        await assert.rejects(attachSkill({ name: "no-such-skill" }, "x", {}), /Unknown skill "no-such-skill"/);
    });

    await test("syncSkillIndex replaces, removes and puts the index back in its place", async () => {

        const section = (type, extra = "") => ({ role: "system", content: `{"type":"${type}"${extra}}` });
        const messages = [section("rules"), section("available_skills", ",\"v\":1"), section("available_agents"), { role: "user", content: "hi" }];

        syncSkillIndex(messages, section("available_skills", ",\"v\":2"));
        assert.equal(messages[1].content, "{\"type\":\"available_skills\",\"v\":2}");

        syncSkillIndex(messages, null);
        assert.deepEqual(messages.map(sectionType), ["rules", "available_agents", null]);

        syncSkillIndex(messages, section("available_skills", ",\"v\":3"));
        assert.deepEqual(messages.map(sectionType), ["rules", "available_skills", "available_agents", null]);

        const plain = [section("rules"), { role: "user", content: "hi" }];
        syncSkillIndex(plain, section("available_skills"));
        assert.deepEqual(plain.map(sectionType), ["rules", "available_skills", null]);
    });

    const stub = await startStub();
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
    const runtime = require(path.join(REPO, "agent", "agent.js"));

    await test("a /skill turn sends the skill and no skill index; the next ordinary turn sends the index", async () => {

        const history = [];

        stub.requests.length = 0;
        await runtime.runAgent({ task: `/skill ${OTHER_LIBRARY_SKILL} review the sign-up form`, history });
        let sent = stub.requests[0].messages;
        assert.equal(indexIn(sent).length, 0, "no skill index beside a chosen skill");
        assert.match(textOf(lastUser(sent)), /^review the sign-up form/);
        assert.ok(textOf(lastUser(sent)).includes(`<skill name="${OTHER_LIBRARY_SKILL}">`));

        stub.requests.length = 0;
        await runtime.runAgent({ task: "now summarise", history });
        sent = stub.requests[0].messages;
        assert.equal(indexIn(sent).length, 1, "the ordinary turn has its index back");
        assert.ok(textOf(indexIn(sent)[0]).includes(LIBRARY_SKILL));
        assert.equal(textOf(lastUser(sent)), "now summarise");

        stub.requests.length = 0;
        await runtime.runAgent({ task: "/skill git", history });
        sent = stub.requests[0].messages;
        assert.equal(indexIn(sent).length, 0, "a later /skill turn drops it again");
        assert.match(textOf(lastUser(sent)), /Apply the skill "git"/);
    });

    await test("an ordinary first turn lists the skills sent to the AI, and the operator's change reaches the next turn", async () => {

        const history = [];

        stub.requests.length = 0;
        await runtime.runAgent({ task: "hello", history });
        assert.ok(!textOf(indexIn(stub.requests[0].messages)[0]).includes(OTHER_LIBRARY_SKILL));

        catalog.setSkillPromptEnabled(OTHER_LIBRARY_SKILL, true);

        try {
            stub.requests.length = 0;
            await runtime.runAgent({ task: "again", history });
            assert.equal(indexIn(stub.requests[0].messages).length, 1);
            assert.ok(textOf(indexIn(stub.requests[0].messages)[0]).includes(OTHER_LIBRARY_SKILL));
        } finally {
            catalog.resetPromptSelection();
        }
    });

    await test("an unknown /skill fails before any model request", async () => {

        stub.requests.length = 0;
        let failure = null;

        try {
            await runtime.runAgent({ task: "/skill no-such-skill do it", history: [] });
        } catch (error) {
            failure = error;
        }

        assert.match(String(failure && failure.message), /Unknown skill "no-such-skill"/);
        assert.equal(stub.requests.length, 0);
    });

    await test("the skill routes: list, admin-only toggle and reset, refusals", async () => {

        const { createServer } = require(path.join(REPO, "web", "server.js"));
        const server = createServer(runtime, { apiRateLimit: 1000 });
        const { port } = await server.listen(0, "127.0.0.1");

        const call = async (method, url, body, token = server.token) => {
            const response = await fetch(`http://127.0.0.1:${port}${url}`, {
                method,
                headers: {
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                    ...(body !== undefined ? { "content-type": "application/json" } : {})
                },
                body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
            });
            return { status: response.status, body: await response.json().catch(() => null) };
        };

        try {
            assert.equal((await call("GET", "/api/skills", undefined, null)).status, 401);

            const listed = await call("GET", "/api/skills");
            assert.equal(listed.status, 200);
            assert.equal(listed.body.skills.length, catalog.listAllSkills().length);
            assert.equal(listed.body.libraries[0].name, "persona");
            assert.equal(listed.body.libraries[0].skills, 218);
            assert.equal(listed.body.prompt.enabled, listed.body.skills.filter(skill => skill.prompt_enabled).length);
            assert.equal(listed.body.prompt.max_chars, settings.get("SKILL_INDEX_MAX_CHARS"));

            assert.equal((await call("GET", "/api/skills?projectId=prj-zzz", undefined, SCOPED)).status, 403);
            assert.equal((await call("GET", "/api/skills?projectId=prj-zzz")).status, 404);

            assert.equal((await call("PUT", "/api/skills/prompt", { name: OTHER_LIBRARY_SKILL, enabled: true }, SCOPED)).status, 403);
            assert.equal((await call("PUT", "/api/skills/prompt", { name: OTHER_LIBRARY_SKILL })).status, 400);
            assert.equal((await call("PUT", "/api/skills/prompt", { name: "../x", enabled: true })).status, 400);
            assert.equal((await call("PUT", "/api/skills/prompt", "{not json")).status, 400);
            assert.equal((await call("PUT", "/api/skills/prompt", { name: "no-such-skill", enabled: true })).status, 404);

            const on = await call("PUT", "/api/skills/prompt", { name: OTHER_LIBRARY_SKILL, enabled: true });
            assert.deepEqual(on, { status: 200, body: { name: OTHER_LIBRARY_SKILL, prompt_enabled: true } });
            assert.ok((await call("GET", "/api/skills")).body.skills.find(skill => skill.name === OTHER_LIBRARY_SKILL).prompt_enabled);

            assert.equal((await call("POST", "/api/skills/prompt/reset", undefined, SCOPED)).status, 403);
            const reset = await call("POST", "/api/skills/prompt/reset");
            assert.equal(reset.status, 200);
            assert.equal(reset.body.reset, true);
            assert.ok(!(await call("GET", "/api/skills")).body.skills.find(skill => skill.name === OTHER_LIBRARY_SKILL).prompt_enabled);
        } finally {
            await server.close();
        }
    });

    await stub.close();

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);

    await removeTempDirs(runtime, TEMP);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
