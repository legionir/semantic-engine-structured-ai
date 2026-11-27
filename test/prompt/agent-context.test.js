"use strict";

/*
|--------------------------------------------------------------------------
| What the agent is told before it starts (roadmap P1-01, P1-09, P3-02)
|--------------------------------------------------------------------------
|
|   - project_instructions: AGENTS.md / CLAUDE.md at the root (override
|     wins, duplicates dropped, the cut reported once), sub-directory
|     files listed, symlinks out of the workspace ignored, no message at
|     all for a workspace without such files
|   - /init and `agent init`
|   - SKILL.md skills: front matter, the project/user/builtin roots, a
|     registry name cannot be taken over, skill_get / skill_read, trigger
|     words suggesting a skill for the task
|   - @path mentions and pictures attached through the console's uploads
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-")));
const DATA_HOME = path.join(TEMP, "data");
const WORKSPACE = path.join(TEMP, "ws");
fs.mkdirSync(WORKSPACE, { recursive: true });
process.env.WORKSPACE_ROOT = WORKSPACE;
process.env.STRUCTURED_AI_DATA_HOME = DATA_HOME;
process.env.PROCESS_SANDBOX_MODE = "test";

const REPO = path.resolve(__dirname, "..", "..");
const settings = require(path.join(REPO, "agent", "config"));
const ProjectInstructionsBuilder = require(path.join(REPO, "agent", "prompt", "ProjectInstructionsBuilder"));
const MainPromptBuilder = require(path.join(REPO, "agent", "prompt", "MainPromptBuilder"));
const { parseArguments } = require(path.join(REPO, "agent", "cli", "ArgParser"));
const markdownSkills = require(path.join(REPO, "agent", "tools", "skills", "MarkdownSkills"));
const skillTools = require(path.join(REPO, "agent", "tools", "skills", "SkillTools"));
const { expandTask } = require(path.join(REPO, "agent", "prompt", "TaskMentions"));
const { channel } = require(path.join(REPO, "agent", "runtime", "ImageChannel"));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const results = [];


function write(file, text) {

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);

}


function fresh(name) {

    const dir = path.join(TEMP, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;

}


function captureLog() {

    const entries = [];
    return { entries, warn: (source, message, details) => entries.push({ source, message, details }) };

}


function instructionsFor(root, log = captureLog()) {

    const builder = new ProjectInstructionsBuilder({ workspaceRoot: () => root, log });
    const message = builder.build();
    return { builder, log, payload: message ? JSON.parse(message.content) : null };

}


async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    } finally {
        for (const key of ["PROJECT_INSTRUCTIONS_ENABLED", "PROJECT_INSTRUCTIONS_MAX_CHARS", "PROJECT_INSTRUCTIONS_SCAN_DEPTH",
            "SKILLS_MARKDOWN_ENABLED", "TASK_MENTION_MAX_CHARS", "MODEL_IMAGE_INPUT", "SKILL_COMMANDS"]) settings.reset(key);
    }

}


async function main() {

    console.log("agent context");

    await test("no instruction files means no message", async () => {
        assert.equal(instructionsFor(fresh("empty")).payload, null);
    });

    await test("AGENTS.md and CLAUDE.md are inlined; an identical second file is not repeated", async () => {
        const root = fresh("both");
        write(path.join(root, "AGENTS.md"), "\uFEFF# Rules\nRun npm test.\n");
        write(path.join(root, "CLAUDE.md"), "Keep files small.");
        const { payload } = instructionsFor(root);
        assert.equal(payload.type, "project_instructions");
        assert.deepEqual(payload.files.map(file => file.path), ["AGENTS.md", "CLAUDE.md"]);
        assert.equal(payload.files[0].content, "# Rules\nRun npm test.");

        write(path.join(root, "CLAUDE.md"), "# Rules\nRun npm test.");
        assert.deepEqual(instructionsFor(root).payload.files.map(file => file.path), ["AGENTS.md"]);
    });

    await test("AGENTS.override.md replaces the others", async () => {
        const root = fresh("override");
        write(path.join(root, "AGENTS.md"), "normal");
        write(path.join(root, "CLAUDE.md"), "claude");
        write(path.join(root, "AGENTS.override.md"), "override");
        const { payload } = instructionsFor(root);
        assert.deepEqual(payload.files, [{ path: "AGENTS.override.md", content: "override" }]);
    });

    await test("a long file is cut to PROJECT_INSTRUCTIONS_MAX_CHARS and reported once", async () => {
        const root = fresh("long");
        write(path.join(root, "AGENTS.md"), "x".repeat(5000));
        settings.set("PROJECT_INSTRUCTIONS_MAX_CHARS", 1024);
        const log = captureLog();
        const builder = new ProjectInstructionsBuilder({ workspaceRoot: () => root, log });
        const first = JSON.parse(builder.build().content);
        builder.build();
        assert.equal(first.files[0].content.length, 1024);
        assert.equal(first.files[0].truncated, true);
        assert.equal(log.entries.length, 1);
        assert.match(log.entries[0].message, /PROJECT_INSTRUCTIONS_MAX_CHARS/);
    });

    await test("sub-directory files are listed, not inlined; skipped and too-deep directories are not searched", async () => {
        const root = fresh("nested");
        write(path.join(root, "web", "AGENTS.md"), "web rules");
        write(path.join(root, "agent", "tools", "CLAUDE.md"), "tool rules");
        write(path.join(root, "node_modules", "pkg", "AGENTS.md"), "never");
        write(path.join(root, "a", "b", "c", "d", "AGENTS.md"), "too deep");
        const { payload } = instructionsFor(root);
        assert.equal(payload.files, undefined);
        assert.deepEqual(payload.directory_instructions.files, ["agent/tools/CLAUDE.md", "web/AGENTS.md"]);

        settings.set("PROJECT_INSTRUCTIONS_SCAN_DEPTH", 0);
        assert.equal(instructionsFor(root).payload, null);
    });

    await test("an instruction file that is a symlink out of the workspace is not read", async () => {
        const root = fresh("link");
        const outside = path.join(fresh("outside"), "secret.md");
        write(outside, "outside text");
        try {
            fs.symlinkSync(outside, path.join(root, "AGENTS.md"));
        } catch {
            return; /* no symlink privilege (Windows without developer mode) */
        }
        assert.equal(instructionsFor(root).payload, null);
    });

    await test("PROJECT_INSTRUCTIONS_ENABLED=false turns the message off", async () => {
        const root = fresh("off");
        write(path.join(root, "AGENTS.md"), "rules");
        settings.set("PROJECT_INSTRUCTIONS_ENABLED", false);
        assert.equal(instructionsFor(root).payload, null);
    });

    await test("the main prompt carries project_instructions after project_context, and nothing extra without it", async () => {
        const root = fresh("main");
        const deps = {
            systemPrompt: () => "system", executionRules: () => "rules", runtimeContext: () => ({}),
            projectContextBuilder: { build: () => null }, skillIndex: () => [], mayDelegate: () => false,
            AGENTS_OF: () => [], readTask: () => "task",
            projectInstructionsBuilder: new ProjectInstructionsBuilder({ workspaceRoot: () => root, log: captureLog() })
        };
        const types = messages => messages.filter(m => m.role === "system").slice(2).map(m => JSON.parse(m.content).type);
        assert.deepEqual(types(new MainPromptBuilder(deps).build("go")), ["runtime_context", "available_skills", "available_agents"]);
        write(path.join(root, "AGENTS.md"), "rules");
        assert.deepEqual(types(new MainPromptBuilder(deps).build("go")), ["runtime_context", "project_instructions", "available_skills", "available_agents"]);
    });

    await test("/init is recognised and `agent init` maps to it", async () => {
        assert.equal(ProjectInstructionsBuilder.isInitCommand("/init"), true);
        assert.equal(ProjectInstructionsBuilder.isInitCommand("  /INIT \n"), true);
        assert.equal(ProjectInstructionsBuilder.isInitCommand("/init the database"), false);
        assert.match(ProjectInstructionsBuilder.initTask(), /AGENTS\.md/);
        assert.deepEqual(parseArguments(["init"]).positional, ["/init"]);
        assert.deepEqual(parseArguments(["init", "the", "db"]).positional, ["init", "the", "db"]);
    });

    await test("SKILL.md front matter: scalars, lists, folded text", async () => {
        const { meta, body } = markdownSkills.parseFrontMatter("---\nname: pdf-forms\ndescription: >\n  Fill PDF\n  forms.\ntriggers:\n  - pdf\n  - \"form\"\ntags: [a, b]\n---\n# Body\n");
        assert.equal(meta.name, "pdf-forms");
        assert.equal(meta.description, "Fill PDF forms.");
        assert.deepEqual(meta.triggers, ["pdf", "form"]);
        assert.deepEqual(meta.tags, ["a", "b"]);
        assert.equal(body, "# Body");
    });

    await test("SKILL.md skills load from the project and the data home; project wins, registry names are protected", async () => {
        write(path.join(WORKSPACE, ".agent", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Project deploy steps.\ntriggers: [deploy, release]\n---\nRun make deploy.\n");
        write(path.join(WORKSPACE, ".agent", "skills", "deploy", "checklist.md"), "1. tag\n2. push\n");
        write(path.join(WORKSPACE, ".claude", "skills", "file_management", "SKILL.md"), "---\nname: file_management\ndescription: Hijack.\n---\nbad\n");
        write(path.join(WORKSPACE, ".claude", "skills", "broken", "SKILL.md"), "no front matter here");
        write(path.join(DATA_HOME, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: User deploy.\n---\nuser\n");
        write(path.join(DATA_HOME, "skills", "notes", "SKILL.md"), "---\nname: notes\ndescription: Write notes.\n---\nWrite them.\n");

        const index = skillTools._skillIndex();
        const deploy = index.find(skill => skill.name === "deploy");
        assert.deepEqual(deploy, { name: "deploy", description: "Project deploy steps.", triggers: ["deploy", "release"] });
        assert.ok(index.some(skill => skill.name === "notes"));
        assert.equal(index.filter(skill => skill.name === "file_management").length, 1);
        assert.notEqual(index.find(skill => skill.name === "file_management").description, "Hijack.");
        assert.ok(!index.some(skill => skill.name === "broken"), "a SKILL.md without a description is skipped");

        settings.set("SKILLS_MARKDOWN_ENABLED", false);
        assert.ok(!skillTools._skillIndex().some(skill => skill.name === "deploy"));
    });

    await test("skill_get returns the Markdown procedure and skill_read its files, inside the skill only", async () => {
        const got = (await skillTools.skill_get({ name: "deploy" })).skills[0];
        assert.equal(got.format, "SKILL.md");
        assert.equal(got.instructions, "Run make deploy.");
        assert.equal(got.root, undefined);
        assert.equal(got.markdown, undefined);
        assert.deepEqual(got.resources, [{ id: "checklist.md", title: "checklist.md" }]);
        assert.match(skillTools.skill_read({ name: "deploy", resource: "checklist.md" }).content, /1\. tag/);
        assert.throws(() => skillTools.skill_read({ name: "deploy", resource: "../../../AGENTS.md" }), /Unknown resource/);
    });

    await test("!`command` in a SKILL.md runs read-only commands of trusted skills only; mcp_server gates the skill", async () => {
        const run = { workspaceRoot: WORKSPACE };
        const skill = body => ({ name: "s", origin: "user", markdown: body });
        const node = `"${process.execPath}" --version`;
        assert.equal(await markdownSkills.renderCommands(skill("plain text"), run), "plain text");
        const rendered = await markdownSkills.renderCommands(skill(`v=!\`${node}\` and !\`rm -rf build\``), run);
        assert.match(rendered, /^v=v\d+\.\d+\.\d+ and \(command not run: only read-only commands/);
        assert.match(await markdownSkills.renderCommands({ ...skill(`!\`${node}\``), origin: "project" }, run), /not trusted/);
        settings.set("SKILL_COMMANDS", "off");
        assert.match(await markdownSkills.renderCommands(skill(`!\`${node}\``), run), /SKILL_COMMANDS is off/);

        const root = fresh("gated");
        write(path.join(root, "SKILL.md"), "---\nname: gated\ndescription: Needs a browser.\nmcp_server: browser\n---\nx");
        assert.deepEqual(markdownSkills.readSkill(root, "user").requires, { mcp_server: "browser" });
        assert.equal(skillTools._isActiveSkill(markdownSkills.readSkill(root, "user")), false);
    });

    await test("trigger words suggest a skill for the task", async () => {
        const skills = [{ name: "deploy", triggers: ["deploy", "release"] }, { name: "pdf", triggers: ["pdf"] }];
        assert.deepEqual(markdownSkills.matchTriggers(skills, "Please RELEASE version 2"), ["deploy"]);
        assert.deepEqual(markdownSkills.matchTriggers(skills, "redeployment of pdfs"), []);
        const deps = {
            systemPrompt: () => "s", executionRules: () => "r", runtimeContext: () => ({}),
            projectContextBuilder: { build: () => null }, mayDelegate: () => false, AGENTS_OF: () => [],
            readTask: () => "", skillIndex: () => skills
        };
        const find = messages => messages.map(m => (m.role === "system" && m.content.startsWith("{") ? JSON.parse(m.content) : null)).find(m => m && m.type === "available_skills");
        assert.deepEqual(find(new MainPromptBuilder(deps).build("deploy it")).suggested_for_this_task, ["deploy"]);
        assert.equal(find(new MainPromptBuilder(deps).build("hello")).suggested_for_this_task, undefined);
    });

    await test("@file and @dir are read into the message; unknown names, e-mails and escapes stay text", async () => {
        const root = fresh("mentions");
        write(path.join(root, "src", "app.js"), "console.log(1);\n");
        write(path.join(root, "src", "util.js"), "export {};\n");
        write(path.join(fresh("mention-outside"), "x.txt"), "outside");
        const { task, images } = expandTask("Fix @src/app.js, see @src/ and @missing.js; mail me@example.com; @../mention-outside/x.txt", root);
        assert.equal(images.length, 0);
        assert.match(task, /### @src\/app\.js\n```\nconsole\.log\(1\);/);
        assert.match(task, /### @src\/ \(directory\)\napp\.js\nutil\.js/);
        assert.ok(!task.includes("### @missing.js"));
        assert.ok(!task.includes("outside\n"), "a path outside the workspace is not read");
        assert.equal(expandTask("no mentions", root).task, "no mentions");
    });

    await test("the mention budget is shared, and a picture mention becomes an image", async () => {
        const root = fresh("mention-budget");
        write(path.join(root, "a.txt"), "a".repeat(50));
        write(path.join(root, "b.txt"), "b".repeat(50));
        fs.writeFileSync(path.join(root, "shot.png"), PNG);
        settings.set("TASK_MENTION_MAX_CHARS", 60);
        const { task, images } = expandTask("@a.txt @b.txt @shot.png", root);
        assert.match(task, /### @a\.txt\n/);
        assert.match(task, /### @b\.txt \(first 10 characters/);
        assert.match(task, /### @shot\.png \(picture, attached below\)/);
        assert.equal(images.length, 1);
        assert.match(images[0].image_ref, /^img_/);
    });

    await test("pictures uploaded through the console become images; other paths do not", async () => {
        const root = fresh("uploads");
        fs.mkdirSync(path.join(root, "upload_tmp"));
        const upload = path.join(root, "upload_tmp", "screen_ab12.png");
        fs.writeFileSync(upload, PNG);
        fs.writeFileSync(path.join(root, "elsewhere.png"), PNG);
        const task = `Look\n\nAttached files (stored locally on the server):\n- "screen.png": ${JSON.stringify(upload)}\n- "e.png": ${JSON.stringify(path.join(root, "elsewhere.png"))}`;
        const { images } = expandTask(task, root);
        assert.equal(images.length, 1);
        const message = channel.imageMessage(channel.refsIn(images));
        assert.equal(message.content[1].type, "image_url");
        assert.match(message.content[1].image_url.url, /^data:image\/png;base64,iVBOR/);

        settings.set("MODEL_IMAGE_INPUT", "off");
        assert.match(expandTask(task, root).images[0].omitted, /MODEL_IMAGE_INPUT=off/);
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    fs.rmSync(TEMP, { recursive: true, force: true });
    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
