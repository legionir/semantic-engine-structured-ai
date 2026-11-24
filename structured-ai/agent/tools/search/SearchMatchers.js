"use strict";

/* Filename matching and per-line search matchers. */

function createSearchMatchers({ sessionRelative }) {
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
    const normalizedQuery = query.replace(/\\/g, "/");
    const normalizedPath = String(relativePath).replace(/\\/g, "/");

    if (!looksLikeGlob(normalizedQuery)) {

        return name
            .toLowerCase()
            .includes(normalizedQuery.toLowerCase());
    }

    if (!session.glob) {

        session.glob = globToRegExp(normalizedQuery);

        /*
        | "src/*.ts" is a path pattern, "*.ts" is a name pattern, so
        | both are tried rather than making the caller know which.
        */

        session.globPath =
            normalizedQuery.includes("/")
                ? globToRegExp(normalizedQuery)
                : globToRegExp(`*/${normalizedQuery}`);
    }

    return (
        session.glob.test(name) ||
        session.glob.test(normalizedPath) ||
        session.globPath.test(normalizedPath)
    );
}


function buildMatcher(session) {

    if (session.mode === "files" || !session.is_regex) {
        return null;
    }

    const RegexWorkerMatcher = require("./RegexWorker");

    return new RegexWorkerMatcher(
        session.query,
        session.case_sensitive ? "g" : "gi"
    );
}


async function countMatchesInLine(
    line,
    session,
    matcher
) {

    if (matcher) {
        return matcher.test(line);
    }

    return session.case_sensitive
        ? line.includes(session.query)
        : line.toLowerCase()
            .includes(
                session.query.toLowerCase()
            );
}



    return { globToRegExp, looksLikeGlob, matchesFileName, buildMatcher, countMatchesInLine };
}

module.exports = { createSearchMatchers };
