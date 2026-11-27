const fs = require("fs");
const path = require("path");

const settings = require("../config");


/*
|--------------------------------------------------------------------------
| Workspace Boundary
|--------------------------------------------------------------------------
|
| Every filesystem capability resolves through this module. Paths are
| resolved to their real location before the boundary check, so symlinks
| inside the workspace cannot be used to escape it.
|--------------------------------------------------------------------------
*/

function resolveWorkspaceRoot() {

    const requested =
        process.env.WORKSPACE_ROOT ||
        process.cwd();

    const resolved =
        path.resolve(requested);

    /*
    | A missing workspace used to surface as a raw ENOENT from
    | realpathSync during module load, which says nothing about what
    | the operator actually got wrong.
    */

    let stats;

    try {

        stats = fs.statSync(resolved);

    } catch (error) {

        if (error.code !== "ENOENT") {
            throw error;
        }

        throw new Error(
            [
                `The workspace does not exist: ${resolved}`,
                `  requested: ${requested}`,
                process.platform === "win32" && requested.startsWith("/")
                    ? "  a path starting with / is drive relative on Windows, use a full path such as C:\\projects\\app"
                    : "  pass an existing directory with --workspace, or set WORKSPACE_ROOT",
                process.platform === "win32"
                    ? "  on Windows cmd: set WORKSPACE_ROOT=C:\\projects\\app && npm run serve"
                    : "  for example: WORKSPACE_ROOT=/path/to/project npm run serve"
            ].join("\n")
        );
    }

    if (!stats.isDirectory()) {

        throw new Error(
            `The workspace is not a directory: ${resolved}`
        );
    }

    return realpath(resolved);
}


/*
| realpathSync.native canonicalises what the platform actually stores:
| on Windows that means the real letter case and the long form of an
| 8.3 name, both of which a prefix comparison would otherwise get
| wrong. It is not available in every environment, so the portable
| implementation stays as the fallback.
*/

function realpath(target) {

    try {

        return fs.realpathSync.native
            ? fs.realpathSync.native(target)
            : fs.realpathSync(target);

    } catch {

        return fs.realpathSync(target);
    }
}


const WORKSPACE_ROOT =
    resolveWorkspaceRoot();



/*
| Capping each string is not enough: a directory tree or a batch read
| can be enormous while every individual string in it is short.
*/



function ignoredDirectories() {

    return settings.get("IGNORED_DIRECTORIES")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}


/*
| The boundary is a prefix comparison, which is exactly right on a case
| sensitive filesystem and exactly wrong on Windows, where D:\Project
| and d:\project are the same directory. Getting that wrong refuses
| legitimate paths rather than allowing bad ones, but it is still a bug,
| and it would bite the moment a workspace is given on another drive
| with a different case than the model uses.
|
| The comparison is a pure function so both platforms can be tested from
| either one.
*/

const CASE_INSENSITIVE_PATHS =
    process.platform === "win32" ||
    process.platform === "darwin";


function isInsideRoot(
    root,
    target,
    caseInsensitive = CASE_INSENSITIVE_PATHS,
    separator = path.sep
) {

    const normalise = value => {

        const trimmed =
            value.length > 1 && value.endsWith(separator)
                ? value.slice(0, -1)
                : value;

        return caseInsensitive
            ? trimmed.toLowerCase()
            : trimmed;
    };

    const left = normalise(root);
    const right = normalise(target);
    const prefix = left === separator ? left : left + separator;

    return (
        right === left ||
        right.startsWith(prefix)
    );
}


function isInsideWorkspace(target) {

    return isInsideRoot(WORKSPACE_ROOT, target);
}


/*
| existsSync follows symlinks, so a dangling link looks absent and every
| walk below would step straight past it to its parent, which is how a
| link to a not-yet-existing file outside the workspace used to pass the
| boundary (P0-3). lstat sees the link itself.
*/

function lexists(target) {

    try {

        fs.lstatSync(target);
        return true;

    } catch (error) {

        if (
            error.code === "ENOENT" ||
            error.code === "ENOTDIR"
        ) {
            return false;
        }

        throw error;
    }
}


function nearestExistingPath(target) {

    let current = target;

    for (;;) {

        if (lexists(current)) {
            return current;
        }

        const parent =
            path.dirname(current);

        if (parent === current) {
            return current;
        }

        current = parent;
    }
}


function resolvePathInRoot(
    root,
    inputPath,
    options = {}
) {

    if (
        inputPath === undefined ||
        inputPath === null ||
        inputPath === ""
    ) {

        throw new Error(
            "Path is required."
        );
    }

    const resolved =
        path.resolve(
            root,
            inputPath
        );

    if (!isInsideRoot(root, resolved)) {

        throw new Error(
            `Path is outside workspace: ${inputPath}`
        );
    }

    /*
    | With noFollow the last segment is kept as it is, so an operation on
    | a symlink (fs_delete, fs_move) acts on the link and never on the
    | file or directory it points to. Its parent is still canonicalised.
    */

    const target =
        options.noFollow &&
        path.relative(root, resolved) !== ""
            ? path.join(
                canonicalPath(path.dirname(resolved)),
                path.basename(resolved)
            )
            : canonicalPath(resolved);

    if (!isInsideRoot(root, target)) {

        throw new Error(
            `Path escapes the workspace through a symlink: ${inputPath}`
        );
    }

    assertNotSecretStore(target, inputPath);

    if (
        options.mustExist &&
        !lexists(target)
    ) {

        throw new Error(
            `Path does not exist: ${inputPath}`
        );
    }

    return target;
}


/*
| The encrypted secret store and its key (P4-01) live in the data home,
| which an operator may well keep inside a workspace. No file tool may
| read, overwrite, move or delete them, wherever they are.
*/

function isSecretStoreFile(target) {

    /* cheap first: a search walk asks this for every file */
    const name = path.basename(String(target)).toLowerCase();

    if (name !== "secrets.enc" && name !== "secrets.key") {
        return false;
    }

    let files;

    try {

        const store = require("../secrets/SecretStore");
        files = [store.storeFile(), store.keyFile()];

    } catch {
        return false;
    }

    const wanted = canonicalPath(path.resolve(target));

    return files.some(file => {

        const real = canonicalPath(path.resolve(file));

        /* inside each other both ways: the same path, case rules included */
        return isInsideRoot(real, wanted) && isInsideRoot(wanted, real);
    });
}


function isSecretStoreOrAncestor(target) {

    let files;

    try {
        const store = require("../secrets/SecretStore");
        files = [store.storeFile(), store.keyFile()];
    } catch {
        return false;
    }

    const realTarget = canonicalPath(path.resolve(String(target)));

    return files.some(file => {
        const realFile = canonicalPath(path.resolve(file));
        return isInsideRoot(realTarget, realFile);
    });
}


function assertNotSecretStore(target, inputPath) {

    if (isSecretStoreFile(target)) {

        throw new Error(
            `Path is the secret store and cannot be used by file tools: ${inputPath}`
        );
    }
}


function assertNotSecretStoreOrAncestor(target, inputPath) {

    if (isSecretStoreOrAncestor(target)) {

        throw new Error(
            `Path contains the secret store and cannot be modified by file tools: ${inputPath}`
        );
    }
}


/*
| The real location of a path that may not exist yet: the deepest
| existing ancestor is resolved through symlinks, then the remaining (not
| yet created) segments are re-attached. A dangling symlink on the way is
| followed by hand, because realpath refuses it while open() and mkdir()
| would happily create its target, so the boundary has to judge where
| the link really leads (P0-3). A cycle of links fails like realpath.
*/

function canonicalPath(target, seen = new Set()) {

    const existing =
        nearestExistingPath(target);

    const suffix =
        path.relative(existing, target);

    let realExisting;

    try {

        realExisting =
            realpath(existing);

    } catch (error) {

        const stats =
            fs.lstatSync(existing);

        if (
            !stats.isSymbolicLink() ||
            seen.has(existing)
        ) {
            throw error;
        }

        seen.add(existing);

        const linked =
            path.resolve(
                path.dirname(existing),
                fs.readlinkSync(existing)
            );

        return canonicalPath(
            suffix === ""
                ? linked
                : path.join(linked, suffix),
            seen
        );
    }

    return suffix === ""
        ? realExisting
        : path.join(realExisting, suffix);
}


function resolveWorkspacePath(
    inputPath,
    options = {}
) {

    return resolvePathInRoot(
        WORKSPACE_ROOT,
        inputPath,
        options
    );
}


function assertPathSafeInRoot(root, target, options = {}) {

    const resolved = path.resolve(target);
    if (!isInsideRoot(root, resolved)) {
        throw new Error(`Path is outside workspace: ${target}`);
    }

    let current = resolved;
    for (;;) {
        if (lexists(current)) {
            const stat = fs.lstatSync(current);
            if (options.rejectSymlinks && stat.isSymbolicLink()) {
                throw new Error(`Symlink components are not allowed for this operation: ${target}`);
            }
        }

        const parent = path.dirname(current);
        if (parent === current || !isInsideRoot(root, parent)) break;
        current = parent;
    }

    if (!isInsideRoot(root, canonicalPath(resolved))) {
        throw new Error(`Path escapes the workspace through a symlink: ${target}`);
    }

    return resolved;
}


function assertWorkspacePathSafe(target, options = {}) {

    return assertPathSafeInRoot(
        WORKSPACE_ROOT,
        target,
        options
    );
}


function toRelativeInRoot(root, target) {

    const relative =
        path.relative(
            root,
            target
        );

    return relative === ""
        ? "."
        : relative;
}


function toWorkspaceRelative(target) {

    return toRelativeInRoot(WORKSPACE_ROOT, target);

}


/*
|--------------------------------------------------------------------------
| Project-relative Boundary (EXECUTION_PLAN Phase 4, گام ۲)
|--------------------------------------------------------------------------
|
| The same boundary rules, anchored at a project root supplied by the
| caller's ProjectContext instead of the process-wide WORKSPACE_ROOT.
| The "project" argument is anything carrying a workspaceRoot (a
| ProjectContext or a minimal { workspaceRoot }); an absent or rootless
| one is a programming error, so it fails loudly rather than silently
| falling back to the global workspace.
|
| Workspace-bound and project-bound names remain separate so a caller
| cannot accidentally mix roots.
|--------------------------------------------------------------------------
*/

function projectRootOf(project) {

    const root =
        project && typeof project === "object"
            ? project.workspaceRoot
            : null;

    if (typeof root !== "string" || root === "") {

        throw new Error(
            "A project-aware operation needs a project with a workspaceRoot; " +
            "without it there is no boundary to resolve against (EXECUTION_PLAN Phase 4)."
        );

    }

    return root;
}


function resolveProjectPath(
    project,
    inputPath,
    options = {}
) {

    return resolvePathInRoot(
        projectRootOf(project),
        inputPath,
        options
    );
}


function assertProjectPathSafe(project, target, options = {}) {

    return assertPathSafeInRoot(
        projectRootOf(project),
        target,
        options
    );
}


function isInsideProject(project, target) {

    return isInsideRoot(
        projectRootOf(project),
        target
    );
}


function toProjectRelative(project, target) {

    return toRelativeInRoot(
        projectRootOf(project),
        target
    );

}


/*
|--------------------------------------------------------------------------
| Result Capping
|--------------------------------------------------------------------------
|
| Tool results are appended to the conversation, so unbounded output
| would grow the request until the model rejects it. Long strings are
| truncated and explicitly marked instead of silently dropped.
|--------------------------------------------------------------------------
*/

function truncateText(
    text,
    limit = settings.get("MAX_TOOL_RESULT_CHARS")
) {

    if (
        typeof text !== "string" ||
        text.length <= limit
    ) {

        return {
            text,
            truncated: false
        };
    }

    return {
        text:
            `${text.slice(0, limit)}\n... [truncated ${
                text.length - limit
            } of ${text.length} characters]`,

        truncated: true
    };
}


function capResult(
    value,
    limit = settings.get("MAX_TOOL_RESULT_CHARS")
) {

    let truncated = false;

    function walk(node) {

        if (typeof node === "string") {

            const capped =
                truncateText(node, limit);

            truncated =
                truncated || capped.truncated;

            return capped.text;
        }

        if (Array.isArray(node)) {
            return node.map(walk);
        }

        if (
            node &&
            typeof node === "object"
        ) {

            const output = {};

            for (
                const [key, item]
                of Object.entries(node)
            ) {
                output[key] = walk(item);
            }

            return output;
        }

        return node;
    }

    const result = walk(value);

    if (
        truncated &&
        result &&
        typeof result === "object" &&
        !Array.isArray(result)
    ) {

        result.output_truncated = true;
    }

    return result;
}


function trimArrays(value, maxItems) {

    if (Array.isArray(value)) {

        const kept =
            value
                .slice(0, maxItems)
                .map(item => trimArrays(item, maxItems));

        if (value.length > maxItems) {

            kept.push({
                omitted_items:
                    value.length - maxItems
            });
        }

        return kept;
    }

    if (
        value &&
        typeof value === "object"
    ) {

        const output = {};

        for (
            const [key, item]
            of Object.entries(value)
        ) {
            output[key] = trimArrays(item, maxItems);
        }

        return output;
    }

    return value;
}


/*
| Shrinks a result until it fits the total budget by keeping fewer
| entries in its longest lists, rather than cutting it off mid structure.
*/

function capTotalSize(
    value,
    limit = settings.get("MAX_TOOL_RESULT_TOTAL_CHARS")
) {

    if (
        !value ||
        typeof value !== "object"
    ) {
        return value;
    }

    if (JSON.stringify(value).length <= limit) {
        return value;
    }

    for (const maxItems of [200, 100, 50, 25, 10, 5, 2]) {

        const trimmed =
            trimArrays(value, maxItems);

        if (JSON.stringify(trimmed).length <= limit) {

            return {
                ...trimmed,

                result_truncated: true,

                truncation_note:
                    `The result was too large, so lists were shortened to ${maxItems} entries each. Narrow the request, for example with a smaller max_depth, a subdirectory, or a file pattern.`
            };
        }
    }

    return {
        ...trimArrays(value, 1),

        result_truncated: true,

        truncation_note:
            "The result was far too large to return. Narrow the request."
    };
}


module.exports = {
    isInsideRoot,
    realpath,
    lexists,
    canonicalPath,
    WORKSPACE_ROOT,
    ignoredDirectories,
    isSecretStoreFile,
    isSecretStoreOrAncestor,
    assertNotSecretStore,
    assertNotSecretStoreOrAncestor,
    capTotalSize,
    resolveWorkspacePath,
    assertWorkspacePathSafe,
    toWorkspaceRelative,
    resolvePathInRoot,
    assertPathSafeInRoot,
    toRelativeInRoot,
    projectRootOf,
    resolveProjectPath,
    assertProjectPathSafe,
    isInsideProject,
    toProjectRelative,
    truncateText,
    capResult
};
