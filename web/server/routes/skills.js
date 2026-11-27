"use strict";

/*
|--------------------------------------------------------------------------
| Skill routes
|--------------------------------------------------------------------------
|
|   GET  /api/skills[?projectId=]   every skill the runtime can load — the
|                                   registry, the runtime's own, the
|                                   operator's, the project's and the shipped
|                                   libraries — and which are sent to the AI
|   PUT  /api/skills/prompt         {name, enabled}: send a skill to the AI
|                                   in the prompt's skill index, or stop
|   POST /api/skills/prompt/reset   back to the defaults (the libraries'
|                                   recommended skills, everything else on)
|
| Any skill, sent to the AI or not, can be attached to one message with
| `/skill <name> [message]`. Changing the selection is server-wide, so it
| needs the admin token; reading it needs project:read.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const { readBody } = require("../RequestBody");
const { sendJson } = require("../Response");

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;


function skillTools() {

    return require("../../../agent/tools/skills/SkillCatalog");
}


/* the skills as a project sees them: its own .agent/.claude skills included */
function withProject(runtime, projectId, fn) {

    if (!projectId) return fn();

    let record;

    try {
        record = runtime.projects.registry().get(projectId);
    } catch (error) {
        throw Object.assign(error, { status: 404 });
    }

    const workspaceRoot = record && (record.workspaceRoot || record.rootPath);

    if (!workspaceRoot) {
        throw Object.assign(new Error(`Unknown project: ${projectId}`), { status: 404 });
    }

    const { runWithProject } = require("../../../agent/runtime/ProjectOverride");

    return runWithProject({ ...record, projectId, workspaceRoot }, fn);
}


function listing(runtime) {

    const tools = skillTools();
    const skills = tools.listAllSkills();
    const index = tools.promptIndex();
    const libraries = require("../../../agent/tools/skills/SkillLibrary").libraries().map(library => ({
        name: library.name,
        title: library.title,
        license: library.license,
        source: library.source,
        skills: library.skills.length,
        recommended: library.recommended
    }));

    return {
        skills,
        libraries,
        prompt: {
            enabled: skills.filter(skill => skill.prompt_enabled).length,
            index_chars: JSON.stringify(index).length,
            max_chars: runtime.settings.get("SKILL_INDEX_MAX_CHARS"),
            names_only: index.filter(entry => entry.description === undefined).length
        }
    };
}


module.exports = async function SkillRoutes(shared, request) {

    const { runtime } = shared;
    const { claims, pathname, refuse, req, requireAdmin, res, url } = request;

    if (pathname === "/api/skills" && req.method === "GET") {

        const projectId = url.searchParams.get("projectId") || null;
        const permission = projectId
            ? consoleAuth.authorize(claims, { projectId, permission: "project:read" })
            : consoleAuth.authorizeUnscoped(claims, "project:read");

        if (refuse(permission)) return true;

        try {
            sendJson(res, 200, withProject(runtime, projectId, () => listing(runtime)));
        } catch (error) {
            sendJson(res, error.status || 500, { error: error.message || "skills unavailable" });
        }

        return true;
    }

    if (pathname === "/api/skills/prompt" && req.method === "PUT") {

        if (requireAdmin()) return true;

        let body;

        try {
            body = await readBody(req);
        } catch (error) {
            sendJson(res, 400, { error: error.message });
            return true;
        }

        if (!body || typeof body.name !== "string" || !NAME_PATTERN.test(body.name) || typeof body.enabled !== "boolean") {
            sendJson(res, 400, { error: "expected {name: <skill name>, enabled: true|false}" });
            return true;
        }

        try {
            const enabled = skillTools().setSkillPromptEnabled(body.name, body.enabled);
            sendJson(res, 200, { name: body.name, prompt_enabled: enabled });
        } catch (error) {
            sendJson(res, error.status || 500, { error: error.message });
        }

        return true;
    }

    if (pathname === "/api/skills/prompt/reset" && req.method === "POST") {

        if (requireAdmin()) return true;

        try {
            skillTools().resetPromptSelection();
            sendJson(res, 200, { reset: true, ...listing(runtime).prompt });
        } catch (error) {
            sendJson(res, 500, { error: error.message });
        }

        return true;
    }

    return false;
};
