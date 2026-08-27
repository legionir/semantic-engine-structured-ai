/*
|--------------------------------------------------------------------------\
| Approval manager
|--------------------------------------------------------------------------\
|
| The lifecycle of one escalation: ask whoever is listening, record the
| answer, and refuse if it was no. Modes:
|
|   auto    approve everything a rule sends for approval, and record it
|   prompt  ask an interactive approver — a handler if one was injected,
|           otherwise the terminal, and if there is no TTY: refuse
|   deny    refuse anything that needs approval, for unattended runs
|
| An interactive front end already owns stdin, so it injects its own
| handler instead of letting the engine open a second reader. That seam is
| `setApprovalHandler`, and the web console is built on it.
|
| The engine never decides *whether* to ask — the rules do. This class only
| answers "how do we ask, and what did we hear back".
|--------------------------------------------------------------------------*/

const readline = require("readline");

const settings = require("../lib/storage");

const {
    deniedByOperator,
    unattendedDenied,
    noInteractiveApprover
} = require("./PolicyErrors");

const { currentProjectId } = require("./ApprovalStore");


/*
| Injected by an interactive front end (the web console, the REPL). Module
| scope, not instance: it is one runtime-wide question with one answerer.
*/

let approvalHandler = null;


/*
| A `scope: global` MCP server is configured once by the operator, so
| approving it once for a project is the honest unit of consent — but every
| use is still audited with the consuming project_id. Only consulted when a
| run actually has a project, so legacy single-project approval is unchanged.
*/

function globalMcpServer(serverName) {

    if (!serverName) {
        return null;
    }

    try {

        const { manager } = require("../mcp/manager");

        const client = manager.client(serverName);

        if (!client) {
            return null;
        }

        return (client.config.scope || "global") === "global"
            ? client
            : null;

    } catch {

        return null;
    }
}


function getApprovalMode() {

    return settings.get("AGENT_APPROVAL");
}


function setApprovalMode(mode) {

    return settings.set("AGENT_APPROVAL", mode);
}


function setApprovalHandler(handler) {

    approvalHandler = handler;
}


class ApprovalManager {

    /*
    | `onRefusal` is the engine's chance to report a decision it did not make.
    | Without it, every refusal below throws before the engine reaches its
    | `onDecision`, so the console's log line for a rejected call —
    | `Policy … rejected` — was unreachable code, and an SSE client saw a
    | tool error but no policy event. The record still throws exactly as
    | before; only the announcement is added.
    */

    constructor({ store, mcpServerOf, onRefusal }) {

        this.store = store;
        this.mcpServerOf = mcpServerOf;
        this.onRefusal =
            typeof onRefusal === "function"
                ? onRefusal
                : null;
    }


    get handler() {

        return approvalHandler;
    }


    refuse(evaluation, record) {

        if (this.onRefusal) {
            this.onRefusal(evaluation, record);
        }
    }


    /*
    | One escalation, from ask to answer to audit record. Returns the record
    | when the call may proceed and throws when it may not — so a caller can
    | never mistake "answered no" for "answered".
    |
    | `project_id` is the evaluation's if something upstream already decided
    | it (a cross-project write in the agent loop does), otherwise the
    | ambient run's. Never from tool arguments.
    */

    async request(evaluation, args) {

        const record = {
            tool: evaluation.tool,
            agent: evaluation.agent,
            reason: evaluation.reason,
            project_id:
                evaluation.project_id || currentProjectId(),
            at: new Date().toISOString()
        };

        return this.settle(evaluation, args, record);
    }


    /*
    | Split out because the engine sometimes hands in a record it built
    | itself, with attribution already stamped.
    */

    async settle(evaluation, args, record) {

        const serverName =
            this.mcpServerOf(evaluation.tool, args);

        const globalServer =
            record.project_id ? globalMcpServer(serverName) : null;

        const cached =
            globalServer
                ? this.store.gatewayGet(serverName)
                : null;

        if (globalServer && cached) {

            record.approved = cached.approved;
            record.mode = "gateway";
            record.gateway_cached = true;

            this.store.record(record);

            if (!cached.approved) {
                this.refuse(evaluation, record);
                throw deniedByOperator(evaluation.tool, evaluation.reason);
            }

            return record;
        }

        if (getApprovalMode() === "deny") {

            record.approved = false;
            record.mode = "deny";

            this.store.record(record);

            this.refuse(evaluation, record);

            throw unattendedDenied(evaluation.tool, evaluation.reason);
        }

        if (
            getApprovalMode() === "prompt" &&
            !approvalHandler &&
            !process.stdin.isTTY
        ) {
            record.approved = false;
            record.mode = "prompt (no tty)";
            this.store.record(record);

            this.refuse(evaluation, record);

            throw noInteractiveApprover(evaluation.tool, evaluation.reason);
        }

        if (
            getApprovalMode() === "prompt" &&
            (approvalHandler || process.stdin.isTTY)
        ) {

            const answer =
                approvalHandler
                    ? await approvalHandler(evaluation, args)
                    : await this.prompt(evaluation, args);

            record.approved = answer;
            record.mode = "prompt";

            this.store.record(record);

            if (globalServer && serverName) {
                this.store.gatewayPut(serverName, { approved: answer });
            }

            if (!answer) {
                this.refuse(evaluation, record);
                throw deniedByOperator(evaluation.tool, evaluation.reason);
            }

            return record;
        }

        record.approved = true;

        record.mode =
            getApprovalMode() === "prompt"
                ? "auto (no tty)"
                : "auto";

        if (globalServer && serverName) {
            this.store.gatewayPut(serverName, { approved: true });
        }

        this.store.record(record);

        return record;
    }


    /* The terminal is the fallback approver, not a second one. */

    prompt(evaluation, args) {

        const rl =
            readline.createInterface({
                input: process.stdin,
                output: process.stderr
            });

        const summary =
            JSON.stringify(args || {}).slice(0, 300);

        return new Promise(resolve => {

            rl.question(
                `\nApproval required\n  agent : ${
                    evaluation.agent
                }\n  tool  : ${
                    evaluation.tool
                }${
                    evaluation.project_id
                        ? `\n  project: ${evaluation.project_id}`
                        : ""
                }\n  reason: ${
                    evaluation.reason
                }\n  args  : ${summary}\nAllow? [y/N] `,
                answer => {

                    rl.close();

                    resolve(
                        /^y(es)?$/i.test(answer.trim())
                    );
                }
            );
        });
    }
}


function getApprovalHandler() {

    return approvalHandler;
}


module.exports = {
    ApprovalManager,
    getApprovalMode,
    setApprovalMode,
    setApprovalHandler,
    getApprovalHandler,
    globalMcpServer
};
