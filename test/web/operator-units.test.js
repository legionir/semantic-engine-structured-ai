"use strict";

/*
|--------------------------------------------------------------------------
| File manager and terminal sessions (units)
|--------------------------------------------------------------------------
|
| FileManager is the only code between the console and the disk: every
| path stays inside its root (symlinks included), writes are atomic and
| refuse to overwrite a file that changed since it was opened, and binary
| or oversized files are described rather than sent. TerminalSessions
| runs shells behind the console's terminal: a fake pty and a fake child
| process drive the pty and pipe modes here, and the real backends this
| machine has are smoke-tested at the end.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const REPO = path.resolve(__dirname, "..", "..");
const { FileManager, looksBinary } = require(path.join(REPO, "web", "server", "console", "file-manager"));
const { TerminalSessions, defaultShell } = require(path.join(REPO, "web", "server", "console", "terminal-sessions"));

const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "operator-units-")));
const ROOT = path.join(TEMP, "root");
const OUTSIDE = path.join(TEMP, "outside");
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


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


async function rejects(promise, status, pattern) {

    try {
        await promise;
    } catch (error) {
        assert.equal(error.status, status, `${error.message} (status ${error.status})`);
        if (pattern) assert.match(error.message, pattern);
        return error;
    }
    throw new Error(`expected a ${status} failure`);
}


function fakePty() {

    const spawned = [];
    return {
        spawned,
        spawn(file, args, options) {
            const child = { file, args, options, pid: 4242 + spawned.length, written: [], sizes: [], killed: [] };
            const data = [];
            const exit = [];
            child.onData = fn => data.push(fn);
            child.onExit = fn => exit.push(fn);
            child.emitData = text => data.forEach(fn => fn(text));
            child.emitExit = (exitCode, signal) => exit.forEach(fn => fn({ exitCode, signal }));
            child.write = text => child.written.push(text);
            child.resize = (cols, rows) => child.sizes.push([cols, rows]);
            child.kill = signal => {
                child.killed.push(signal);
                setImmediate(() => child.emitExit(0, 1));
            };
            spawned.push(child);
            return child;
        }
    };
}


function fakeSpawn() {

    const spawned = [];
    const impl = (file, args, options) => {
        const child = new EventEmitter();
        Object.assign(child, { file, args, options, pid: null, written: [] });
        child.stdin = new EventEmitter();
        child.stdin.write = text => child.written.push(text);
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => setImmediate(() => child.emit("close", null, "SIGTERM"));
        spawned.push(child);
        return child;
    };
    impl.spawned = spawned;
    return impl;
}


function fakeResponse() {

    const res = new EventEmitter();
    res.chunks = [];
    res.writeHead = () => res;
    res.setHeader = () => {};
    res.flushHeaders = () => {};
    res.write = chunk => {
        res.chunks.push(String(chunk));
        return true;
    };
    res.end = () => res.emit("close");
    return res;
}


async function fileManagerTests() {

    fs.mkdirSync(path.join(ROOT, "src"), { recursive: true });
    fs.mkdirSync(OUTSIDE, { recursive: true });
    fs.writeFileSync(path.join(ROOT, "src", "app.js"), "console.log(1)\n");
    fs.writeFileSync(path.join(ROOT, "image.bin"), Buffer.from([0x89, 0x50, 0, 0, 1, 2]));
    fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "outside");
    let linked = false;
    try {
        fs.symlinkSync(path.join(OUTSIDE, "secret.txt"), path.join(ROOT, "escape.txt"));
        fs.symlinkSync(OUTSIDE, path.join(ROOT, "escape-dir"), "dir");
        fs.symlinkSync(path.join(ROOT, "src", "app.js"), path.join(ROOT, "inside.js"));
        linked = true;
    } catch {
        /* symlinks need extra rights on Windows */
    }

    let limit = 64;
    const files = new FileManager({ root: ROOT, maxBytes: () => limit });

    await test("list() sorts folders first and describes links by where they point", async () => {
        const listing = await files.list(".");
        assert.equal(listing.path, ".");
        assert.equal(listing.parent, null);
        assert.equal(listing.entries[0].name, "src");
        assert.equal(listing.entries[0].type, "directory");
        if (linked) {
            const byName = Object.fromEntries(listing.entries.map(entry => [entry.name, entry]));
            assert.equal(byName["inside.js"].target_type, "file");
            assert.equal(byName["escape.txt"].target_type, "broken", "a link out of the root is not followed");
        }
        const nested = await files.list("/src/");
        assert.deepEqual([nested.path, nested.parent, nested.entries.map(entry => entry.name)], ["src", ".", ["app.js"]]);
        await rejects(files.list("src/app.js"), 400, /Not a directory/);
        await rejects(files.list("missing"), 404);
    });

    await test("paths cannot leave the root, by .. or by a symlink", async () => {
        await rejects(files.list("../outside"), 400);
        await rejects(files.read("../outside/secret.txt"), 400);
        await rejects(files.read("src/\0x"), 400, /NUL/);
        await rejects(files.read(42), 400, /path must be a string/);
        if (linked) {
            await rejects(files.read("escape.txt"), 400, /symlink/);
            await rejects(files.list("escape-dir"), 400, /symlink/);
            await rejects(files.write("escape-dir/new.txt", "x"), 400);
            await rejects(files.write("escape.txt", "x"), 400, /symlink/);
            await rejects(files.write("inside.js", "hacked\n"), 400, /symlink/);
            assert.equal(fs.lstatSync(path.join(ROOT, "inside.js")).isSymbolicLink(), true, "in-root symlink is not replaced");
            assert.equal(fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8"), "console.log(1)\n", "target file is unchanged");
            assert.ok(!fs.existsSync(path.join(OUTSIDE, "new.txt")));
            assert.equal((await files.read("inside.js")).content, "console.log(1)\n");
            await files.remove("escape-dir");
            assert.ok(fs.existsSync(path.join(OUTSIDE, "secret.txt")), "deleting a link leaves its target");
        }
    });

    await test("read() returns text, and describes binary and oversized files without content", async () => {
        const text = await files.read("src/app.js");
        assert.deepEqual([text.content, text.binary, text.too_large, text.size], ["console.log(1)\n", false, false, 15]);
        const binary = await files.read("image.bin");
        assert.deepEqual([binary.binary, binary.content], [true, null]);
        fs.writeFileSync(path.join(ROOT, "big.txt"), "x".repeat(100));
        const big = await files.read("big.txt");
        assert.deepEqual([big.too_large, big.max_bytes, big.content], [true, 64, null]);
        await rejects(files.read("src"), 400, /Is a directory/);
        assert.equal(looksBinary(Buffer.from("plain text")), false);
    });

    await test("write() is atomic, keeps the mode and refuses a stale mtime with 409", async () => {
        const target = path.join(ROOT, "src", "app.js");
        if (process.platform !== "win32") fs.chmodSync(target, 0o755);
        const opened = await files.read("src/app.js");
        const saved = await files.write("src/app.js", "console.log(2)\n", opened.mtime_ms);
        assert.equal(saved.created, false);
        assert.equal(fs.readFileSync(target, "utf8"), "console.log(2)\n");
        if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o755);
        assert.deepEqual(fs.readdirSync(path.join(ROOT, "src")).filter(name => name.endsWith(".tmp")), []);

        await sleep(20);
        fs.writeFileSync(target, "changed elsewhere\n");
        const conflict = await rejects(files.write("src/app.js", "mine\n", saved.mtime_ms), 409, /changed on disk/);
        assert.equal(conflict.current_mtime_ms, Math.trunc(fs.statSync(target).mtimeMs));
        assert.equal(fs.readFileSync(target, "utf8"), "changed elsewhere\n", "the newer file is kept");
        await files.write("src/app.js", "mine\n");
        assert.equal(fs.readFileSync(target, "utf8"), "mine\n", "without expected_mtime_ms it overwrites");

        assert.equal((await files.write("deep/new/file.txt", "hi")).created, true);
        await rejects(files.write("src/app.js", "x".repeat(65)), 413);
        await rejects(files.write("src", "x"), 400, /Is a directory/);
        await rejects(files.write(".", "x"), 400);
        await rejects(files.write("a.txt", 5), 400);
    });

    await test("create(), rename() and remove() with their refusals", async () => {
        const created = await files.create("notes/todo.txt", "file");
        assert.deepEqual([created.path, created.type], ["notes/todo.txt", "file"]);
        await rejects(files.create("notes/todo.txt", "file"), 409);
        await rejects(files.create("x", "socket"), 400);
        assert.equal((await files.create("empty-dir", "directory")).type, "directory");

        const moved = await files.rename("notes", "archive/notes");
        assert.equal(moved.path, "archive/notes");
        assert.ok(fs.existsSync(path.join(ROOT, "archive", "notes", "todo.txt")));
        await rejects(files.rename("archive", "archive/inner"), 400, /into itself/);
        await rejects(files.rename("archive", "src"), 409);
        await rejects(files.rename(".", "x"), 400);
        await rejects(files.rename("missing", "x"), 404);

        await rejects(files.remove("archive"), 409);
        assert.deepEqual(await files.remove("archive", true), { path: "archive", type: "directory" });
        assert.ok(!fs.existsSync(path.join(ROOT, "archive")));
        await files.remove("empty-dir");
        await rejects(files.remove("."), 400);
        await rejects(files.remove("missing"), 404);

        const download = await files.openForDownload("image.bin");
        assert.deepEqual([download.name, download.size], ["image.bin", 6]);
        await rejects(files.openForDownload("src"), 400);
    });

    await test("upload() stores any bytes atomically, asks before replacing and enforces its own limit", async () => {
        const { Readable } = require("stream");
        const bytes = Buffer.from([0, 1, 2, 250, 255, 0, 10, 13]);
        const stored = await files.upload("uploads/pic.bin", Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), { maxBytes: 1024 });
        assert.deepEqual([stored.path, stored.size, stored.created], ["uploads/pic.bin", 8, true]);
        assert.deepEqual(fs.readFileSync(path.join(ROOT, "uploads", "pic.bin")), bytes, "binary bytes are kept exactly");

        const clash = await rejects(files.upload("uploads/pic.bin", Readable.from([Buffer.from("x")]), { maxBytes: 1024 }), 409, /Already exists/);
        assert.equal(clash.exists, true);
        assert.deepEqual(fs.readFileSync(path.join(ROOT, "uploads", "pic.bin")), bytes, "a refused upload leaves the file alone");
        const replaced = await files.upload("uploads/pic.bin", Readable.from([Buffer.from("new")]), { overwrite: true, maxBytes: 1024 });
        assert.deepEqual([replaced.created, fs.readFileSync(path.join(ROOT, "uploads", "pic.bin"), "utf8")], [false, "new"]);

        await rejects(files.upload("uploads/huge.bin", Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), { maxBytes: 1024 }), 413, /CONSOLE_FILE_UPLOAD_MAX_BYTES/);
        assert.ok(!fs.existsSync(path.join(ROOT, "uploads", "huge.bin")), "an oversized upload leaves nothing behind");
        assert.deepEqual(fs.readdirSync(path.join(ROOT, "uploads")).filter(name => name.endsWith(".upload")), [], "no temp file is left");

        await rejects(files.upload("../outside/x.bin", Readable.from([Buffer.from("x")])), 400);
        await rejects(files.upload("src", Readable.from([Buffer.from("x")]), { overwrite: true }), 400, /Is a directory/);
        await rejects(files.upload(".", Readable.from([Buffer.from("x")])), 400);
        if (linked) {
            await rejects(files.upload("inside.js", Readable.from([Buffer.from("x")]), { overwrite: true }), 400, /symlink/);
        }
        await files.remove("uploads", true);
    });

    limit = 64;
}


async function terminalTests() {

    await test("pty mode: output reaches the scrollback and every attached stream; input and resize reach the pty", async () => {
        const pty = fakePty();
        const logged = [];
        const terminals = new TerminalSessions({ cwd: ROOT, ptyModule: pty, shell: "/bin/fake-sh", onLog: (...args) => logged.push(args) });
        assert.equal(terminals.mode(), "pty");

        const session = terminals.create({ cols: 9999, rows: "x" });
        assert.deepEqual([session.cols, session.rows, session.mode, session.cwd], [500, 30, "pty", ROOT]);
        const child = pty.spawned[0];
        assert.equal(child.file, "/bin/fake-sh");
        assert.equal(child.options.env.TERM, "xterm-256color");

        child.emitData("hello ");
        const res = fakeResponse();
        assert.equal(terminals.attach(session.id, new EventEmitter(), res), true);
        child.emitData("world");
        const stream = res.chunks.join("");
        assert.match(stream, /"type":"snapshot"/);
        assert.match(stream, /"data":"hello "/, "the snapshot replays the scrollback");
        assert.match(stream, /"type":"output","data":"world"/);

        terminals.write(session.id, "ls\r");
        assert.deepEqual(child.written, ["ls\r"]);
        assert.deepEqual(terminals.resize(session.id, 120, 40), { cols: 120, rows: 40, applied: true });
        assert.deepEqual(child.sizes, [[120, 40]]);
        assert.throws(() => terminals.resize(session.id, "wide", 40), /integers/);
        assert.throws(() => terminals.write(session.id, ""), /non-empty/);
        assert.equal(terminals.write("nope", "x"), null);
        assert.equal(terminals.get(12), null);

        child.emitExit(3, 0);
        assert.deepEqual(terminals.list()[0].exited.code, 3, "an exited shell stays listed so its output can be read");
        assert.match(res.chunks.join(""), /"type":"exit","code":3/);
        assert.throws(() => terminals.write(session.id, "x"), error => error.status === 409);
        assert.ok(logged.some(([level, message]) => level === "info" && /Terminal exited/.test(message)));
        assert.equal(terminals.kill(session.id), true, "killing an exited shell forgets it");
        assert.deepEqual(terminals.list(), []);
    });

    await test("kill() forgets the session as soon as it exits, and the session limit counts live shells only", async () => {
        const pty = fakePty();
        const terminals = new TerminalSessions({ cwd: ROOT, ptyModule: pty, maxSessions: () => 2 });
        const first = terminals.create();
        terminals.create();
        assert.throws(() => terminals.create(), error => error.status === 409 && /At most 2/.test(error.message));

        assert.equal(terminals.kill(first.id), true);
        assert.deepEqual(pty.spawned[0].killed, [process.platform === "win32" ? undefined : "SIGHUP"]);
        await sleep(10);
        assert.equal(terminals.get(first.id), null, "not kept for the retention period");
        assert.equal(terminals.kill(first.id), false);

        pty.spawned[1].emitExit(0, 0);
        terminals.create();
        terminals.create();
        assert.equal(terminals.list().length, 3, "the exited one does not count against the limit");
        terminals.shutdown();
        assert.deepEqual(terminals.list(), []);
    });

    await test("pipe mode turns Enter into a newline, survives stdin errors and reports a spawn failure", async () => {
        const spawnImpl = fakeSpawn();
        const terminals = new TerminalSessions({ cwd: ROOT, ptyModule: null, scriptPath: null, spawnImpl, shell: "/opt/shells/sh", platform: "linux" });
        assert.equal(terminals.mode(), "pipe");
        const session = terminals.create({ cols: 80, rows: 24 });
        const child = spawnImpl.spawned[0];
        assert.deepEqual([child.file, child.args, child.options.env.COLUMNS, child.options.env.LINES], ["/opt/shells/sh", ["-i"], "80", "24"]);

        terminals.write(session.id, "echo hi\r");
        assert.deepEqual(child.written, ["echo hi\n"]);
        child.stdin.emit("error", new Error("EPIPE"));
        child.stdout.emit("data", Buffer.from([0xe2, 0x82]));
        child.stderr.emit("data", Buffer.from([0xac, 0x0a]));
        assert.equal(terminals.get(session.id).scrollback, "€\n", "a character split across chunks is decoded whole");
        assert.equal(terminals.resize(session.id, 100, 30).applied, false);

        child.emit("error", new Error("spawn /opt/shells/sh ENOENT"));
        assert.match(terminals.get(session.id).scrollback, /\[terminal\] spawn \/opt\/shells\/sh ENOENT/);
        assert.ok(terminals.get(session.id).exited);
        terminals.shutdown();
    });

    await test("script mode wraps the shell in script(1) with a pty of its own", async () => {
        const spawnImpl = fakeSpawn();
        const linux = new TerminalSessions({ cwd: ROOT, ptyModule: null, scriptPath: "/usr/bin/script", spawnImpl, shell: "/opt/shells/bash", platform: "linux" });
        assert.equal(linux.mode(), "script");
        const session = linux.create();
        const linuxArgs = spawnImpl.spawned[0].args;
        assert.equal(spawnImpl.spawned[0].file, "/usr/bin/script");
        assert.deepEqual(linuxArgs.slice(0, 5), ["-q", "-f", "-e", "-c", "/opt/shells/bash -i"]);
        assert.match(linuxArgs[5], /^\/dev\/null$/, "the typescript itself is discarded");
        linux.write(session.id, "pwd\r");
        assert.deepEqual(spawnImpl.spawned[0].written, ["pwd\r"], "the pty inside script(1) handles Enter itself");
        linux.shutdown();

        const mac = new TerminalSessions({ cwd: ROOT, ptyModule: null, scriptPath: "/usr/bin/script", spawnImpl, shell: "/opt/shells/zsh", platform: "darwin" });
        mac.create();
        const macArgs = spawnImpl.spawned[1].args;
        assert.deepEqual([macArgs[0], macArgs[2], macArgs[3]], ["-q", "/opt/shells/zsh", "-i"]);
        assert.match(macArgs[1], /^\/dev\/null$/);
        mac.shutdown();

        assert.equal(defaultShell("win32", { COMSPEC: "C:\\Windows\\cmd.exe" }), "C:\\Windows\\cmd.exe");
        assert.equal(defaultShell("win32", {}), "powershell.exe");
        assert.equal(defaultShell("linux", { SHELL: "relative/sh" }) !== "relative/sh", true);
    });

    await test("the real backend available here runs a command", async () => {
        const terminals = new TerminalSessions({ cwd: ROOT });
        const session = terminals.create({ cols: 80, rows: 24 });
        const marker = "OPERATOR_UNITS_OK";
        const command = process.platform === "win32" ? `echo ${marker}_%OS%\r` : `echo ${marker}_$((6*7))\r`;
        await sleep(300);
        terminals.write(session.id, command);
        const expected = process.platform === "win32" ? `${marker}_Windows_NT` : `${marker}_42`;
        for (let waited = 0; waited < 8000 && !terminals.get(session.id).scrollback.includes(expected); waited += 50) await sleep(50);
        assert.ok(terminals.get(session.id).scrollback.includes(expected), `${terminals.mode()}: ${JSON.stringify(terminals.get(session.id).scrollback.slice(-400))}`);
        terminals.kill(session.id);
        for (let waited = 0; waited < 4000 && terminals.get(session.id); waited += 50) await sleep(50);
        assert.equal(terminals.get(session.id), null, `${terminals.mode()} shell ended by kill()`);
    });
}


async function main() {

    console.log("file manager and terminal sessions");
    await fileManagerTests();
    await terminalTests();

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 });
    process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
