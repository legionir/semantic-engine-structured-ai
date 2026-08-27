"use strict";

/*
|--------------------------------------------------------------------------
| Web console graph route (EXECUTION_PLAN Phase 23 گام ۲)
|--------------------------------------------------------------------------
| The visualizer's read of a project index: two views, architecture/module
| and symbols/calls.
|
| The root is resolved in order of authority: a `?projectId=` the token may
| see (403 otherwise, 404 when unregistered), then the workspace root, then
| the legacy index locations the console has served from. A missing index is
| a *successful* answer with no nodes, not an error — the panel has to be
| able to say "not indexed yet" instead of failing to draw.
|
| The caps (20 modules, 50 symbols, 40 edges) belong to the transport, not
| to the graph: a worker laying out more is slower than the browser is
| useful. Both were in the original and both are the recorded contract for
| this route.
|--------------------------------------------------------------------------
*/

const fs = require("fs");
const path = require("path");
const consoleAuth = require("../../../agent/lib/consoleAuth");

function createGraphController(ctx) {

    const { runtime, calls } = ctx;

    /* ---------------------------------------------- graph visualization */

    async function view(req, res, url, pathname, claims) {

        const viewType = pathname.slice("/api/graph/".length);
        let root = path.resolve(runtime.workspaceRoot || process.cwd());
        let projectName = path.basename(root);
        const graphProjectId = url.searchParams.get("projectId");

        if (
            graphProjectId &&
            graphProjectId !== "current" &&
            runtime.projects &&
            typeof runtime.projects.registry === "function"
        ) {

            const allowed =
                consoleAuth.authorize(claims, {
                    projectId: graphProjectId,
                    permission: "project:read"
                });

            if (!allowed.ok) {

                ctx.sendJson(res, allowed.status, { error: allowed.error });
                return;
            }

            try {

                const record =
                    runtime.projects.registry().get(graphProjectId);

                root = path.resolve(record.rootPath);
                projectName = record.name;

            } catch {

                ctx.sendJson(res, 404, { error: "Unknown project" });
                return;
            }
        }

        const rootBase = path.basename(root).toLowerCase();
        const rootParent = path.basename(path.dirname(root)).toLowerCase();

        if (rootBase === ".agent" || rootBase === ".semantic-engine") {
            root = path.dirname(root);
        } else if (rootBase === "semantic" && rootParent === ".agent") {
            root = path.dirname(path.dirname(root));
        }

        const indexCandidates = [
            path.join(root, ".semantic-engine", "project-index.json"),
            /* compatibility with older Structured AI indexes */
            path.join(root, ".agent", "semantic", "project-index.json"),
            path.join(root, "semantic", "project-index.json")
        ];
        const indexPath =
            indexCandidates.find(candidate => fs.existsSync(candidate)) || indexCandidates[0];

        let nodes = [];
        let edges = [];

        if (fs.existsSync(indexPath)) {
            try {
                const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
                projectName = index.root || projectName;

                if (viewType === "architecture" || viewType === "module") {
                    const allFiles = Array.isArray(index.files) ? index.files : Object.values(index.files || {});
                    const topDirs = new Set();
                    allFiles.forEach(f => {
                        const parts = f.path.split("/");
                        if (parts.length > 1) topDirs.add(parts.slice(0, 2).join("/"));
                        else topDirs.add("root");
                    });

                    Array.from(topDirs).slice(0, 20).forEach(dir => {
                        nodes.push({ id: `mod-${dir}`, type: "module", label: dir, metadata: { path: dir, importance: 80 } });
                    });

                    const depEdges = index.graphs?.dependencyGraph || index.graphs?.dependencies || [];
                    depEdges.slice(0, 40).forEach((e, idx) => {
                        edges.push({ id: `e-${idx}`, source: e.from, target: e.to, relation: "depends_on", metadata: { confidence: e.provenance?.confidence || 90 } });
                    });
                } else {
                    const allSymbols = (index.symbols || []).slice(0, 50);
                    allSymbols.forEach(s => {
                        nodes.push({ id: s.id, type: s.kind === "class" ? "class" : "function", label: s.name, metadata: { path: s.filePath, line: s.line, endLine: s.endLine, complexity: s.complexity || 1, referencesCount: s.referenceCount || 0 } });
                    });

                    const callEdges = index.graphs?.callGraph || index.graphs?.calls || [];
                    callEdges.slice(0, 40).forEach((e, idx) => {
                        edges.push({ id: `call-${idx}`, source: e.caller || e.from, target: e.callee || e.to, relation: "calls", metadata: { confidence: e.provenance?.confidence || 90 } });
                    });
                }
            } catch {
                /* fallback */
            }
        }

        ctx.sendJson(res, 200, {
            view: viewType,
            projectName,
            nodes,
            edges
        });

    }

    return {
        view
    };
}

module.exports = { createGraphController };
