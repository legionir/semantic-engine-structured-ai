"use strict";

/* REPL command vocabulary — EXECUTION_PLAN Phase 26. */

const COMMANDS = `
Commands
  /help                 show this list
  /exit, /quit          leave the session
  /clear                start a new conversation, keeping the settings
  /history              show the conversation so far
  /approve [mode]       show or set auto | prompt | deny
  /model [name]         show or set the model for the next task
  /workspace            show the directory the agent may act in
  /limits               show the execution limits
  /stats                show what the runtime has executed
  /tools, /agents, /policy   show the registries
  /save <file>          write the last answer to a file
  /init                 write AGENTS.md: instructions for agents working on this project

Anything else is sent to the agent as a task.
Ctrl-C cancels the running task, Ctrl-D leaves the session.
`.trim();

function splitCommand(line) {
    const [command, ...rest] = line.slice(1).trim().split(/\s+/);
    return { command, argument: rest.join(" ").trim() };
}

module.exports = {
    COMMANDS,
    splitCommand
};
