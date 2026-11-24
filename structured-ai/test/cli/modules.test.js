"use strict";

/*
|--------------------------------------------------------------------------
| CLI/REPL module boundary — EXECUTION_PLAN Phase 26
|--------------------------------------------------------------------------
|
| cli.test.js and interactive.test.js keep end-to-end command behavior. This
| suite locks the extracted parser, command, formatter and REPL seams.
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const REPO = path.resolve(__dirname, "..", "..");
const CLI_DIR = path.join(REPO, "agent", "cli");
const INTERACTIVE_DIR = path.join(REPO, "agent", "interactive");
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


async function main() {
  await test("all CLI and REPL modules exist and bin facades point to them", () => {
    [
      "ArgParser.js", "CommandRegistry.js", "OutputFormatter.js", "RunCommand.js",
      "ServeCommand.js", "InteractiveCommand.js", "HelpCommand.js", "Cli.js", "index.js"
    ].forEach(name => assert.equal(fs.existsSync(path.join(CLI_DIR, name)), true, name));
    [
      "Repl.js", "ReplCommands.js", "InputReader.js", "OutputRenderer.js",
      "ApprovalPrompt.js", "index.js"
    ].forEach(name => assert.equal(fs.existsSync(path.join(INTERACTIVE_DIR, name)), true, name));
    assert.equal(require(path.join(REPO, "bin", "agent.js")).main, require(path.join(REPO, "agent", "cli")).main);
    assert.equal(require(path.join(REPO, "bin", "interactive.js")).startSession, require(path.join(REPO, "agent", "interactive")).startSession);
  });

  await test("ArgParser normalizes every public command family", () => {
    const { parseArguments } = require(path.join(CLI_DIR, "ArgParser"));
    const options = parseArguments([
      "--project", "prj-a", "-w", "/tmp", "--approve", "auto", "--dry-run",
      "--until-done", "--max-cycles", "4", "--discussion", "--personas", "a,b",
      "--max-rounds", "3", "-s", "7788", "--host", "0.0.0.0", "--json", "-q",
      "--model", "model-x", "--temperature", "0.4", "--base-url", "https://example.test",
      "--api-key", "secret", "--timeout", "5", "--max-iterations", "7",
      "--max-agents", "2", "task", "words"
    ]);
    assert.equal(options.project, "prj-a");
    assert.equal(options.workspace, "/tmp");
    assert.equal(options.port, 7788);
    assert.deepEqual(options.personas, ["a", "b"]);
    assert.deepEqual(options.positional, ["task", "words"]);
    assert.equal(options.timeoutSeconds, 5);
    assert.equal(options.maxAgents, 2);
  });

  await test("ArgParser reports usage errors without process.exit when used directly", () => {
    const { parseArguments, UsageError } = require(path.join(CLI_DIR, "ArgParser"));
    assert.throws(() => parseArguments(["--unknown"]), error => error instanceof UsageError && error.exitCode === 2);
    assert.throws(() => parseArguments(["--timeout", "nope"]), /expects a number/);
    assert.throws(() => parseArguments(["--project"]), /requires a value/);
  });

  await test("CommandRegistry and HelpCommand keep deterministic dispatch", async () => {
    const { CommandRegistry } = require(path.join(CLI_DIR, "CommandRegistry"));
    const { HelpCommand } = require(path.join(CLI_DIR, "HelpCommand"));
    const output = { value: "", write(value) { this.value += value; } };
    const registry = new CommandRegistry({ help: new HelpCommand({ usage: "usage", version: "1" }) });
    assert.deepEqual(registry.names(), ["help"]);
    assert.equal(await registry.execute("help", "version", output), 0);
    assert.equal(output.value, "1\n");
    await assert.rejects(() => registry.execute("missing"), /unknown CLI command/);
  });

  await test("OutputFormatter preserves structured failure output and duration", () => {
    const formatter = require(path.join(CLI_DIR, "OutputFormatter"));
    const error = formatter.actionError(new Error("failed"));
    assert.equal(error.action, "final");
    assert.equal(error.error.message, "failed");
    assert.match(formatter.json(error), /"retryable": false/);
    assert.equal(formatter.formatDuration(999), "999 ms");
    assert.equal(formatter.formatDuration(1000), "1.0 s");
  });

  await test("REPL command vocabulary and InputReader preserve ordered input", async () => {
    const { COMMANDS, splitCommand } = require(path.join(INTERACTIVE_DIR, "ReplCommands"));
    const { InputReader } = require(path.join(INTERACTIVE_DIR, "InputReader"));
    assert.match(COMMANDS, /\/help/);
    assert.deepEqual(splitCommand("/approve auto"), { command: "approve", argument: "auto" });
    const reader = new InputReader();
    reader.push("first");
    assert.equal(await reader.read(), "first");
    const pending = reader.read("no");
    reader.push("second");
    assert.equal(await pending, "second");
    reader.close("n");
    assert.equal(await reader.read("fallback"), "fallback");
  });

  await test("ApprovalPrompt renders through the injected reader and stream", async () => {
    const { createApprovalHandler } = require(path.join(INTERACTIVE_DIR, "ApprovalPrompt"));
    const output = { value: "", write(value) { this.value += value; } };
    const colours = { yellow: value => value, bold: value => value, green: value => value, red: value => value };
    const handler = createApprovalHandler({
      readAnswer: async () => "yes",
      colours,
      output
    });
    assert.equal(await handler({ agent: "worker", tool: "fs_write", reason: "review" }, { path: "a" }), true);
    assert.match(output.value, /approval required/);
    assert.match(output.value, /approved/);

    const patchOutput = { value: "", write(value) { this.value += value; } };
    const patchHandler = createApprovalHandler({
      readAnswer: async () => "no",
      colours,
      output: patchOutput
    });
    const diff = "--- a/example.txt\n+++ b/example.txt\n" + "@@ hunk @@\n" + "-old\n+new\n".repeat(80);
    assert.equal(await patchHandler({ agent: "worker", tool: "apply_patch", reason: "review diff" }, {
      paths: ["example.txt"],
      patch: diff
    }), false);
    assert.match(patchOutput.value, /example.txt/);
    assert.match(patchOutput.value, /-old/);
    assert.ok(patchOutput.value.length > 200, "patch preview was truncated to the generic 200-character limit");
  });

  await test("InteractiveCommand resolves the extracted REPL path", async () => {
    const { InteractiveCommand } = require(path.join(CLI_DIR, "InteractiveCommand"));
    const command = new InteractiveCommand({ repoRoot: REPO });
    assert.equal(command.repoRoot, REPO);
    await assert.rejects(() => command.execute({}, { json: true }), /--json cannot be combined/);
  });

  await test("ServeCommand validates command conflicts before binding a server", async () => {
    const { ServeCommand } = require(path.join(CLI_DIR, "ServeCommand"));
    const command = new ServeCommand({ repoRoot: REPO });
    await assert.rejects(() => command.execute({}, { interactive: true }), /--serve cannot be combined/);
  });

  await test("the canonical Repl remains a CommonJS module", () => {
    const source = fs.readFileSync(path.join(INTERACTIVE_DIR, "Repl.js"), "utf8");
    assert.doesNotMatch(source, /require\(["'][^"']*bin[\\/]interactive\.js["']\)/);
    assert.match(source, /createApprovalHandler/);
    assert.match(source, /splitCommand/);
    assert.equal(typeof require(path.join(INTERACTIVE_DIR, "Repl")).startSession, "function");
  });

  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
