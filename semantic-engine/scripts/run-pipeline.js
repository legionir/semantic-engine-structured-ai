#!/usr/bin/env node
"use strict";

/*
| Pipeline runner
| ---------------
|
|   node scripts/run-pipeline.js <workspace> <output-dir>
|
| Drives the compiled IndexPipeline in dist/ and writes project-index.json
| and blueprint.json. It exercises the code the package ships rather than
| whatever ts-jest produces, and it has no VS Code in it.
|
| Phase 03 left this duplicating a chunk of extension.ts because there was
| no pipeline to call. Phase 12 extracted one, so this is now the thin
| caller it was meant to be.
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function need(relative) {

    const full = path.join(DIST, relative);

    if (!fs.existsSync(`${full}.js`)) {
        console.error(
            `error: ${relative}.js not found in dist. Run "npm run build" first.`
        );
        process.exit(1);
    }

    return require(full);
}


async function main() {

    const [workspace, outDir] = process.argv.slice(2);

    if (!workspace || !outDir) {
        console.error("usage: run-pipeline.js <workspace> <output-dir>");
        process.exit(1);
    }

    const { IndexPipeline } = need("pipeline/IndexPipeline");
    const { createExtractors } = need("pipeline/ExtractorFactory");
    const { BlueprintExporter } = need("export/BlueprintExporter");
    const { NodeFileSystem } = need("host/FileSystem");

    fs.mkdirSync(outDir, { recursive: true });

    const indexPath = path.join(outDir, "project-index.json");

    /*
    | tree-sitter is on as of phase 17, which is when the mapper became
    | worth exercising. It is what the package actually uses for TS and
    | JS, so a baseline recorded without it was measuring the fallback
    | rather than the product. Git and vectors stay out: both reach
    | outside the fixture and neither is deterministic.
    */

    const extractors = createExtractors({
        workspaceRoot: workspace,
        treeSitter: true,
        grammarDir: path.join(ROOT, "tree-sitter-grammars")
    });

    try {

        const { projectIndex, stats } = await new IndexPipeline({
            workspaceRoot: workspace,
            outputPath: indexPath,
            symbolExtractors: extractors.symbols,
            dependencyExtractors: extractors.dependencies,
            scannerConfig: { skipHiddenDirectories: false },
            gitCollector: null,
            vectorIndexer: null,
            pretty: true
        }).run();

        const port = new NodeFileSystem();

        await port.writeJsonAtomic(indexPath, projectIndex, { pretty: true });

        await new BlueprintExporter().export(projectIndex, {
            outputPath: path.join(outDir, "blueprint.json"),
            pretty: true
        });

        console.log(
            `pipeline: ${stats.files} files, ` +
            `${stats.symbols} symbols, ` +
            `${projectIndex.graphs.dependencyGraph.length} dependency edges, ` +
            `${stats.fileReads} file reads`
        );

    } finally {
        extractors.dispose();
    }
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
