"use strict";

/*
|--------------------------------------------------------------------------
| Web API contract tests — EXECUTION_PLAN Phase 29
|--------------------------------------------------------------------------
|
| RouteInventory is the implementation-side catalogue, while
| fixtures/api-surface.json is the captured public contract. Keep the two
| independent so a route can be accidentally registered without updating
| the documented response shape. These checks cover the stable status and
| required-key portions; endpoint-specific tests continue to exercise the
| live server in test/web and test/web/routes.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const apiSurface = require(path.join(ROOT, "test", "fixtures", "api-surface.json"));
const { ROUTES, keys } = require(path.join(ROOT, "web", "server", "RouteInventory"));
const { Router } = require(path.join(ROOT, "web", "server", "Router"));
const response = require(path.join(ROOT, "web", "server", "Response"));
const serializers = require(path.join(ROOT, "web", "server", "serializers"));

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.message}`);
    }
}

function fakeResponse() {
    return {
        status: null,
        headers: null,
        chunks: [],
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        end(value) {
            if (value !== undefined) this.chunks.push(String(value));
        }
    };
}

async function main() {
    await test("the captured method/path inventory matches the live route boundary", async () => {
        assert.ok(Array.isArray(apiSurface.method_paths));
        assert.deepStrictEqual(keys(), apiSurface.method_paths);
        assert.equal(new Set(apiSurface.method_paths).size, apiSurface.method_paths.length);
        assert.equal(ROUTES.length, apiSurface.method_paths.length);
        assert.ok(apiSurface.method_paths.includes("POST /api/projects/:projectId/discussions"));
        assert.ok(apiSurface.method_paths.includes("GET /api/projects/:projectId/discussions/:discussionId"));
    });

    await test("each documented response contract declares a stable status and required keys", async () => {
        const contracts = apiSurface.response_contracts;
        assert.ok(contracts && typeof contracts === "object");
        for (const [name, contract] of Object.entries(contracts)) {
            assert.match(name, /^[a-z0-9_]+$/);
            assert.ok(Number.isInteger(contract.status), `${name} has no status`);
            assert.ok(Array.isArray(contract.required), `${name} has no required keys`);
            assert.ok(contract.required.length > 0, `${name} has an empty required-key list`);
        }
        assert.equal(contracts.model_catalog.status, 200);
        assert.deepStrictEqual(contracts.model_catalog.required, ["models"]);
        assert.equal(contracts.legacy_task.status, 202);
        assert.deepStrictEqual(contracts.legacy_task.required, ["accepted"]);
        assert.ok(contracts.project_task.required.includes("project_id"));
        assert.ok(contracts.discussion_replay.required.includes("discussion"));
    });

    await test("dynamic API paths preserve encoded project and discussion identity", async () => {
        const router = new Router();
        let seen = null;
        router.get("/api/projects/:projectId/discussions/:discussionId", request => {
            seen = request.params;
        });
        await router.handle(
            { method: "GET", url: "/api/projects/project%2Fa/discussions/discussion%2F1", headers: { host: "test" } },
            { writeHead() {}, end() {} }
        );
        assert.deepStrictEqual(seen, {
            projectId: "project/a",
            discussionId: "discussion/1"
        });
        assert.equal(router.match("POST", "/api/projects/project%2Fa/discussions/discussion%2F1"), null);
    });

    await test("JSON responses retain status, content type and error-key contracts", async () => {
        const accepted = fakeResponse();
        response.sendJson(accepted, apiSurface.response_contracts.legacy_task.status, { accepted: true });
        assert.equal(accepted.status, 202);
        assert.match(accepted.headers["content-type"], /^application\/json/);
        const acceptedBody = JSON.parse(accepted.chunks[0]);
        for (const key of apiSurface.response_contracts.legacy_task.required) {
            assert.ok(Object.prototype.hasOwnProperty.call(acceptedBody, key), `missing ${key}`);
        }

        const error = fakeResponse();
        response.sendError(error, 400, "bad request", { code: "BAD_REQUEST" });
        assert.equal(error.status, 400);
        assert.deepStrictEqual(JSON.parse(error.chunks[0]), {
            error: "bad request",
            code: "BAD_REQUEST"
        });
    });

    await test("project and approval serializers keep additive identity fields", async () => {
        const project = serializers.project({ id: "prj-a", name: "Alpha" });
        assert.deepStrictEqual(project, { project: { id: "prj-a", name: "Alpha" } });

        const approval = serializers.approval({
            id: "approval-1",
            agent: "main_agent",
            tool: "fs_write",
            reason: "contract",
            arguments: { path: "a.txt" },
            project_id: "prj-a"
        });
        assert.equal(approval.project_id, "prj-a");
        assert.equal(approval.tool, "fs_write");
        assert.deepStrictEqual(serializers.approvals([approval]), [approval]);
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
