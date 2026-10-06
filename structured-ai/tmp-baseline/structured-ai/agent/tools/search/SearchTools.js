const fs = require("fs");
const path = require("path");

const settings = require("../../config");

const {
    ignoredDirectories,
    toRelativeInRoot,
    toWorkspaceRelative
} = require("../../context/WorkspaceBoundary");

const ToolContext = require("../ToolContext");


/*
|--------------------------------------------------------------------------
| Search Sessions
|--------------------------------------------------------------------------
|
| A search runs as a background session so a large tree never blocks the
| agent loop. search_start returns results inline when the search finishes
| within wait_ms, otherwise it returns a handle to poll with search_get.
|--------------------------------------------------------------------------
*/

const SESSIONS = new Map();

let sessionCounter = 0;



/*
| Paths are shown relative to the search's own root: the project root
| for a project-scoped run (Phase 8), the workspace root otherwise —
| which is exactly what toWorkspaceRelative already printed in legacy
| mode, so legacy output is bit-identical.
*/
function sessionRelative(session, target) {

    return session.tool_root
        ? toRelativeInRoot(session.tool_root, target)
        : toWorkspaceRelative(target);
}


function globToRegExp(pattern) {

    const escaped =
        pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");

    return new RegExp(
        `^${escaped}$`,
        "i"
    );
}


/*
| A model asked for "*.test.*" and got nothing back, because file names
| were matched by substring, and then spent two more iterations guessing
| what this tool wanted. A query that looks like a glob is treated as
| one, against the name and against the workspace relative path, and
| anything else keeps the forgiving substring behaviour.
*/

function looksLikeGlob(query) {

    return /[*?]/.test(query);
}


function matchesFileName(session, name, relativePath) {

    const query = session.query;

    if (!looksLikeGlob(query)) {

        return name
            .toLowerCase()
            .includes(query.toLowerCase());
    }

    if (!session.glob) {

        session.glob = globToRegExp(query);

        /*
        | "src/*.ts" is a path pattern, "*.ts" is a name pattern, so
        | both are tried rather than making the caller know which.
        */

        session.globPath =
            query.includes("/")
                ? globToRegExp(query)
                : globToRegExp(`*/${query}`);
    }

    return (
        session.glob.test(name) ||
        session.glob.test(relativePath) ||
        session.globPath.test(relativePath)
    );
}


function buildMatcher(session) {

    if (session.mode === "files") {
        return null;
    }

    if (session.is_regex) {

        return new RegExp(
            session.query,
            session.case_sensitive
                ? "g"
                : "gi"
        );
    }

    return null;
}


function countMatchesInLine(
    line,
    session,
    matcher
) {

    if (matcher) {

        matcher.lastIndex = 0;

        return matcher.test(line);
    }

    return session.case_sensitive
        ? line.includes(session.query)
        : line.toLowerCase()
            .includes(
                session.query.toLowerCase()
            );
}


async function runSearch(session) {

    const excluded =
        new Set([
            ...ignoredDirectories(),
            ...session.exclude
        ]);

    const nameFilter =
        session.file_pattern
            ? globToRegExp(session.file_pattern)
            : null;

    const matcher =
        buildMatcher(session);

    async function walk(directory, depth) {

        if (
            session.status !== "running" ||
            session.results.length >= session.max_results ||
            depth > session.max_depth
        ) {
            return;
        }

        let entries;

        try {

            entries =
                await fs.promises.readdir(
                    directory,
                    {
                        withFileTypes: true
                    }
                );

        } catch {

            return;
        }

        for (const entry of entries) {

            if (
                session.status !== "running" ||
                session.results.length >= session.max_results
            ) {
                return;
            }

            const fullPath =
                path.join(
                    directory,
                    entry.name
                );

            if (entry.isDirectory()) {

                if (excluded.has(entry.name)) {
                    continue;
                }

                await walk(fullPath, depth + 1);

                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            session.files_scanned++;

            if (
                nameFilter &&
                !nameFilter.test(entry.name)
            ) {
                continue;
            }

            if (session.mode === "files") {

                if (
                    !session.query ||
                    matchesFileName(
                        session,
                        entry.name,
                        sessionRelative(session, fullPath)
                    )
                ) {

                    session.results.push({
                        path:
                            sessionRelative(session, fullPath)
                    });
                }

                continue;
            }

            let content;

            try {

                const buffer =
                    await fs.promises.readFile(fullPath);

                if (
                    buffer.subarray(0, settings.get("BINARY_PROBE_BYTES")).includes(0)
                ) {
                    continue;
                }

                content =
                    buffer.toString("utf8");

            } catch {

                continue;
            }

            const lines =
                content.split("\n");

            for (
                let index = 0;
                index < lines.length;
                index++
            ) {

                if (
                    session.results.length >=
                    session.max_results
                ) {

                    session.result_limit_reached = true;

                    return;
                }

                if (
                    countMatchesInLine(
                        lines[index],
                        session,
                        matcher
                    )
                ) {

                    session.results.push({
                        path:
                            sessionRelative(session, fullPath),

                        line:
                            index + 1,

                        text:
                            lines[index].trim().slice(0, 400)
                    });
                }
            }
        }
    }

    try {

        await walk(session.root, 0);

        if (session.status === "running") {
            session.status = "completed";
        }

    } catch (error) {

        session.status = "failed";
        session.error = error.message;

    } finally {

        session.finished_at = Date.now();
    }
}


function pruneSessions() {

    if (SESSIONS.size <= settings.get("MAX_SEARCH_SESSIONS")) {
        return;
    }

    const finished =
        [...SESSIONS.values()]
            .filter(
                session =>
                    session.status !== "running"
            )
            .sort(
                (a, b) =>
                    (a.finished_at || 0) -
                    (b.finished_at || 0)
            );

    for (const session of finished) {

        if (SESSIONS.size <= settings.get("MAX_SEARCH_SESSIONS")) {
            return;
        }

        SESSIONS.delete(session.id);
    }
}


function describeSession(
    session,
    includeResults,
    offset = 0
) {

    const description = {
        search_id:
            session.id,

        status:
            session.status,

        mode:
            session.mode,

        query:
            session.query,

        path:
            sessionRelative(session, session.root),

        files_scanned:
            session.files_scanned,

        total_results:
            session.results.length,

        result_limit_reached:
            session.result_limit_reached,

        elapsed_ms:
            (session.finished_at || Date.now()) -
            session.started_at
    };

    if (session.error) {
        description.error = session.error;
    }

    if (includeResults) {

        description.offset =
            offset;

        description.results =
            session.results.slice(offset);
    }

    return description;
}


/*
|--------------------------------------------------------------------------
| search_start
|--------------------------------------------------------------------------
*/

async function searchStart(args, context) {

    /* Phase 8: the search walks the run's project tree. The ToolContext
       supplies the root; in legacy mode this is WORKSPACE_ROOT itself,
       so the resolution is the historical one. */
    const ctx = ToolContext.from(context);

    const root =
        ctx.resolvePath(
            args.path || ".",
            {
                mustExist: true
            }
        );

    if (
        typeof args.query !== "string" ||
        args.query.length === 0
    ) {

        throw new Error(
            "query is required."
        );
    }

    if (args.is_regex) {

        try {

            new RegExp(args.query);

        } catch (error) {

            throw new Error(
                `Invalid regular expression: ${error.message}`
            );
        }
    }

    sessionCounter++;

    const session = {
        id:
            `search_${sessionCounter}`,

        /* The project that owns this session: another project's get / list /
           stop must never reach it (null = the default/legacy project). */
        project_id:
            context && context.projectId
                ? context.projectId
                : null,

        /* The run that owns this session (modular mode); a run-scoped
           reset clears only its own sessions, never a concurrent
           run's. */
        run_id:
            context && context.runId
                ? context.runId
                : null,

        /* The project root this session answers relative-path queries
           against (scoped runs); null means "the workspace root",
           which keeps legacy display and glob matching unchanged. */
        tool_root:
            ctx.scoped
                ? ctx.root
                : null,

        root,

        mode:
            args.mode === "files"
                ? "files"
                : "content",

        query:
            args.query,

        file_pattern:
            typeof args.file_pattern === "string"
                ? args.file_pattern
                : null,

        is_regex:
            args.is_regex === true,

        case_sensitive:
            args.case_sensitive === true,

        exclude:
            Array.isArray(args.exclude)
                ? args.exclude
                : [],

        max_results:
            Number.isInteger(args.max_results)
                ? args.max_results
                : 200,

        max_depth:
            Number.isInteger(args.max_depth)
                ? args.max_depth
                : 20,

        results: [],

        files_scanned: 0,

        result_limit_reached: false,

        status: "running",

        error: null,

        started_at: Date.now(),

        finished_at: null
    };

    SESSIONS.set(session.id, session);

    pruneSessions();

    session.promise =
        runSearch(session);

    const waitMs =
        Number.isInteger(args.wait_ms)
            ? args.wait_ms
            : 5000;

    await Promise.race([
        session.promise,

        new Promise(
            resolve =>
                setTimeout(resolve, waitMs)
        )
    ]);

    return describeSession(
        session,
        session.status !== "running",
        0
    );
}


/*
|--------------------------------------------------------------------------
| search_get
|--------------------------------------------------------------------------
*/

/*
| A session is visible only to the project that started it. A foreign handle
| is reported exactly like an unknown one, so a project cannot even probe for
| another project's search ids.
*/
function ownedSession(searchId, context) {

    const session = SESSIONS.get(searchId);

    if (!session) {
        return undefined;
    }

    const caller =
        context && context.projectId
            ? context.projectId
            : null;

    return session.project_id === caller
        ? session
        : undefined;
}


async function searchGet(args, context) {

    const session =
        ownedSession(args.search_id, context);

    if (!session) {

        throw new Error(
            `Unknown search: ${args.search_id}`
        );
    }

    if (
        session.status === "running" &&
        Number.isInteger(args.wait_ms)
    ) {

        await Promise.race([
            session.promise,

            new Promise(
                resolve =>
                    setTimeout(resolve, args.wait_ms)
            )
        ]);
    }

    return describeSession(
        session,
        true,
        Number.isInteger(args.offset)
            ? args.offset
            : 0
    );
}


/*
|--------------------------------------------------------------------------
| search_list
|--------------------------------------------------------------------------
*/

async function searchList(_args, context) {

    const caller =
        context && context.projectId
            ? context.projectId
            : null;

    const own =
        [...SESSIONS.values()].filter(
            session => session.project_id === caller
        );

    return {
        count:
            own.length,

        searches:
            own.map(
                session =>
                    describeSession(session, false)
            )
    };
}


/*
|--------------------------------------------------------------------------
| search_stop
|--------------------------------------------------------------------------
*/

async function searchStop(args, context) {

    const session =
        ownedSession(args.search_id, context);

    if (!session) {

        throw new Error(
            `Unknown search: ${args.search_id}`
        );
    }

    if (session.status === "running") {

        session.status = "stopped";
        session.finished_at = Date.now();
    }

    return describeSession(session, false);
}


/* No argument: the historical process-wide reset. With a run id only
   that run's sessions are stopped and cleared. */
function resetSessions(runId) {

    for (
        const [id, session]
        of [...SESSIONS.entries()]
    ) {

        if (runId && session.run_id !== runId) {
            continue;
        }

        if (session.status === "running") {
            session.status = "stopped";
        }

        SESSIONS.delete(id);
    }
}


module.exports = {
    search_start: searchStart,
    search_get: searchGet,
    search_list: searchList,
    search_stop: searchStop,

    resetSessions,

    _sessions: SESSIONS
};
