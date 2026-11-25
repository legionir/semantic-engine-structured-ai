"use strict";

/*
| project-stores.test.js: from "sessions and the archive are separated per project"
|
| Runs inside project-stores.test.js, in order, with what the runner set up
| (passed in `ctx`); a test here may rely on what an earlier group did.
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");


module.exports = async function sessionsAndTheArchiveAreSeparatedCases(ctx) {

    const {
        ROOT_A,
        ROOT_B,
        archive,
        centralRoot,
        legacyRoot,
        projectFile,
        sessions,
        settings,
        test,
        writeJson
    } = ctx;

    await test("sessions and the archive are separated per project", async () => {


        try {

            /* sessions */

            const sessionA = sessions.emptySession("s-p8-a");

            sessionA.messages.push({ role: "user", content: "hello a" });

            sessions.saveSession(sessionA, centralRoot("prj-a"));

            const listedA = sessions.listSessions(centralRoot("prj-a"));
            const listedB = sessions.listSessions(centralRoot("prj-b"));

            assert.equal(listedA.length, 1);
            assert.equal(listedA[0].id, "s-p8-a");
            assert.equal(listedB.length, 0, "B must not list A's session");

            /* replay of A's session is per project too */

            const replayed = sessions.loadSession("s-p8-a", centralRoot("prj-a"));

            assert.equal(replayed.messages[0].content, "hello a");

            assert.equal(
                sessions.loadSession("s-p8-a", centralRoot("prj-b")),
                null
            );

            /* archive: write to A, prove B's index and bodies are empty */

            const report = archive.archiveEvents(
                [
                    {
                        tool: "fs_read",
                        title: "read alpha into memory",
                        body: "the archived body of prj-a"
                    }
                ],
                { root: centralRoot("prj-a") }
            );

            assert.equal(report.added, 1);

            assert.equal(archive.stats({ root: centralRoot("prj-a") }).records, 1);
            assert.equal(archive.stats({ root: centralRoot("prj-b") }).records, 0);

            const foundA = archive.searchArchive("alpha", { root: centralRoot("prj-a") });
            const foundB = archive.searchArchive("alpha", { root: centralRoot("prj-b") });

            assert.equal(foundA.matches, 1);
            assert.equal(foundB.matches, 0, "B's archive must not match A's record");

            const records = archive.getRecords(
                [foundA.results[0].id],
                { root: centralRoot("prj-a") }
            );

            assert.equal(records.records[0].body, "the archived body of prj-a");

            const sameFromB = archive.getRecords(
                [foundA.results[0].id],
                { root: centralRoot("prj-b") }
            );

            assert.deepEqual(sameFromB.records, []);
            assert.deepEqual(sameFromB.missing, [foundA.results[0].id]);

        } finally {


        }

    });


    await test("the settings overlay reads floor-with-cap and writes central only", async () => {


        try {

            /* SA-F-007: the workspace/floor layer of a REGISTERED project is
               that project's OWN root (<rootPath>/.agent/project.json), never
               the process workspace's file. A decoy floor is planted in the
               process workspace to prove it is NOT read for prj-a.
               cap:   the central file of the registered project. */

            const ownFloorFile = path.join(ROOT_A, ".agent", "project.json");
            const capFile = path.join(centralRoot("prj-a"), "project.json");

            /* a decoy in the process workspace: a DIFFERENT project's settings
               that must never contaminate prj-a */
            const decoyFloorFile = path.join(legacyRoot(), "project.json");

            const ownFloor = {

                version: "1",
                name: "workspace",
                created_at: "2026-08-01T00:00:00.000Z",
                opened: 7,
                settings: {
                    AGENT_MODEL: "floor-model",
                    AGENT_VERBOSE: "0"
                }
            };

            const decoyFloor = {

                version: "1",
                name: "other",
                created_at: "2026-08-01T00:00:00.000Z",
                opened: 99,
                settings: {
                    AGENT_MODEL: "decoy-model",
                    AGENT_VERBOSE: "9"
                }
            };

            const cap = {

                version: "1",
                name: "workspace",
                created_at: "2026-08-02T00:00:00.000Z",
                opened: 3,
                settings: {
                    AGENT_MODEL: "cap-model"
                }
            };

            writeJson(ownFloorFile, ownFloor);
            writeJson(decoyFloorFile, decoyFloor);
            writeJson(capFile, cap);

            const merged = projectFile.loadOverlay("prj-a");

            /* cap wins per key, the project's OWN floor fills the rest;
               the process-workspace decoy is ignored entirely */

            assert.equal(merged.settings.AGENT_MODEL, "cap-model");
            assert.equal(merged.settings.AGENT_VERBOSE, "0");
            assert.equal(merged.opened, 3);

            /* opening applies the overlay and records the visit on the
               central target ONLY — the project's own floor stays byte-exact */

            const floorBefore = fs.readFileSync(ownFloorFile, "utf8");

            const opened = projectFile.openProject("prj-a");

            assert.equal(settings.get("AGENT_MODEL"), "cap-model");
            assert.equal(settings.get("AGENT_VERBOSE"), "0");
            assert.equal(
                opened.path,
                ownFloorFile,
                "the floor layer must be the project's own workspace, not the process one"
            );
            assert.equal(opened.overlay_path, capFile);

            assert.equal(
                fs.readFileSync(ownFloorFile, "utf8"),
                floorBefore,
                "the legacy floor must not be written in the overlay model"
            );

            const capAfter = JSON.parse(fs.readFileSync(capFile, "utf8"));

            assert.equal(capAfter.opened, 4);
            assert.ok(capAfter.last_opened_at, "the visit went into the cap");

            /* the raw legacy (unprojected) read is still the process workspace */

            assert.equal(
                projectFile.loadProject().settings.AGENT_MODEL,
                "decoy-model"
            );

            settings.reset("AGENT_MODEL");
            settings.reset("AGENT_VERBOSE");

        } finally {


        }

    });


    await test("SA-F-007: two projects resolve their OWN settings floors (no cross-contamination)", async () => {


        try {

            /* project A's own workspace holds A's floor; project B's own
               workspace holds B's floor; the process workspace holds a third.
               Each openProject must see only its own project's values —
               switching context must switch the resolved settings. */

            const capFileA = path.join(centralRoot("prj-a"), "project.json");
            const capFileB = path.join(centralRoot("prj-b"), "project.json");

            writeJson(path.join(ROOT_A, ".agent", "project.json"), {
                version: "1",
                settings: { AGENT_MODEL: "A-model", AGENT_TEMPERATURE: "0.1" }
            });

            writeJson(path.join(ROOT_B, ".agent", "project.json"), {
                version: "1",
                settings: { AGENT_MODEL: "B-model", AGENT_VERBOSE: "1" }
            });

            /* neither registered project has a central cap here: the floor is
               the whole answer, so the process workspace must NOT leak in */
            if (fs.existsSync(capFileA)) fs.rmSync(capFileA);
            if (fs.existsSync(capFileB)) fs.rmSync(capFileB);

            const overlayA = projectFile.loadOverlay("prj-a");
            const overlayB = projectFile.loadOverlay("prj-b");

            assert.equal(overlayA.settings.AGENT_MODEL, "A-model");
            assert.equal(overlayB.settings.AGENT_MODEL, "B-model");
            assert.equal(overlayA.settings.AGENT_VERBOSE, undefined,
                "B's settings must not appear under A");
            assert.equal(overlayB.settings.AGENT_TEMPERATURE, undefined,
                "A's settings must not appear under B");

            const openedA = projectFile.openProject("prj-a");
            assert.equal(settings.get("AGENT_MODEL"), "A-model");
            assert.equal(openedA.path, path.join(ROOT_A, ".agent", "project.json"));

            const openedB = projectFile.openProject("prj-b");
            assert.equal(settings.get("AGENT_MODEL"), "B-model");
            assert.equal(openedB.path, path.join(ROOT_B, ".agent", "project.json"));

            /* switching back to A resolves A again — the process cwd/WORKSPACE_ROOT
               is never the deciding factor for a registered project */
            projectFile.openProject("prj-a");
            assert.equal(settings.get("AGENT_MODEL"), "A-model");

            /* an UNKNOWN project id honestly falls back to the process floor
               (deterministic, documented behaviour — not a wrong project's file) */
            const unknown = projectFile.loadOverlay("prj-does-not-exist");
            assert.equal(unknown.settings.AGENT_MODEL, "decoy-model");

            settings.reset("AGENT_MODEL");
            settings.reset("AGENT_TEMPERATURE");
            settings.reset("AGENT_VERBOSE");

        } finally {


        }

    });
};
