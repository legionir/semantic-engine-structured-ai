/*
|--------------------------------------------------------------------------\
| Approval store
|--------------------------------------------------------------------------\
|
| Two kinds of state, deliberately in one place because they are the same
| question at two moments: what was asked and answered (the audit trail,
| what `summary()` reports and the log line quotes), and what is still
| waiting for an operator (the pending map the web console renders as
| buttons).
|
| Both are project-scoped from phase 9 onward: a pending approval carries
| the `project_id` of the run that raised it, and every read may be
| filtered by it. That filter lives here rather than in each caller because
| a forgotten filter is a cross-project leak, not a cosmetic bug.
|
| The gateway cache (`scope: global` MCP servers approved once and reused
| across projects) also lives here: it is approval state, and its lifetime
| is the process, not a run.
|--------------------------------------------------------------------------*/


/*
| Which project a decision belongs to, taken from the ambient run — never
| from tool arguments, which the model can write (rule 9).
*/

function currentProjectId() {

    try {

        const runtime = require("../runtime");

        if (typeof runtime.effectiveProjectId === "function") {

            const overridden = runtime.effectiveProjectId();

            if (overridden) {
                return overridden;
            }

        }

        const run =
            runtime.runManager && typeof runtime.runManager.current === "function"
                ? runtime.runManager.current()
                : null;

        return run && run.projectId ? run.projectId : null;

    } catch {

        return null;
    }
}


/*
| Phase 9: one gateway-level approval for a `scope: global` MCP server,
| reused across projects; each use is still audited with the consuming
| project_id.
|
| Module-level and shared by default, exactly as the single Map that lived
| in lib/policy.js was: `resetGatewayApprovals()` has to clear the cache the
| engines actually consult, not a copy of it, and tests rely on that.
*/

const gatewayApprovals = new Map();


function resetGatewayApprovals() {

    gatewayApprovals.clear();
}


class ApprovalStore {

    /*
    | `records` is handed in rather than created, so the engine can keep
    | exposing its audit trail as the plain Array it always was — same
    | identity, same `.length`, same `[i]` — while every write goes through
    | `record()` and therefore through one place per-project scoping runs.
    */

    constructor({ records, pending, gateway, idPrefix = "approval_" } = {}) {

        /* The console's ids have always looked like `approval_N_<ts>`; the
           prefix is a parameter only so a test can build a store that cannot
           disturb the shared numbering. */
        this.idPrefix =
            idPrefix;

        /* Audit trail: one entry per decision the engine had to make. */
        this.records =
            Array.isArray(records)
                ? records
                : [];

        /* Requests a human (or a console) still has to answer. */
        this.pending =
            pending instanceof Map
                ? pending
                : new Map();

        /* Phase 9: one gateway approval per scope:global MCP server. */
        this.gateway =
            gateway instanceof Map
                ? gateway
                : gatewayApprovals;

        /*
        | Monotonic, not `pending.size + 1`. Counting the queue collides the
        | moment a request is taken and another begins in the same millisecond
        | — `approval_2_<ts>` twice — and because pending is keyed by that id,
        | a collision silently replaces one open question with another: the
        | first one can never be answered again.
        */
        this.sequence = 0;
    }


    /* ---- audit trail ---- */

    record(entry) {

        this.records.push(entry);

        return entry;
    }


    /* A run with no project sees the whole trail, exactly as before. */

    list(projectId) {

        if (!projectId) {
            return [...this.records];
        }

        return this.records.filter(
            entry =>
                entry.project_id === projectId
        );
    }


    clear() {

        this.records.length = 0;
    }


    /* ---- pending requests ---- */

    /*
    | The id format is load-bearing: the browser posts it back to
    | `/api/approvals/:id`, and `approval_N_<ts>` is what the UI has always
    | received. Counting pending rather than total keeps that numbering
    | stable when old requests have already resolved.
    */

    begin(request) {

        this.sequence += 1;

        const id =
            `${this.idPrefix}${this.sequence}_${Date.now()}`;

        const entry =
            { ...request, id };

        this.pending.set(id, entry);

        return entry;
    }


    get(id) {

        return this.pending.get(id) || null;
    }


    /*
    | Take removes it: resolving twice must not resolve anything, which is
    | how the endpoint answers 404 on a second click.
    */

    take(id) {

        const entry =
            this.pending.get(id);

        if (!entry) {
            return null;
        }

        this.pending.delete(id);

        return entry;
    }


    listPending({ projectId, includeUnscoped = true } = {}) {

        const entries =
            [...this.pending.values()];

        if (!projectId) {
            return entries;
        }

        return entries.filter(
            entry =>
                (includeUnscoped && !entry.project_id) ||
                entry.project_id === projectId
        );
    }


    pendingIds() {

        return [...this.pending.keys()];
    }


    get pendingCount() {

        return this.pending.size;
    }


    /* ---- gateway-level approvals (phase 9) ---- */

    gatewayGet(serverName) {

        return this.gateway.get(serverName) || null;
    }


    gatewayPut(serverName, approval) {

        this.gateway.set(serverName, {
            ...approval,
            at: Date.now()
        });
    }


    resetGateway() {

        this.gateway.clear();
    }
}


module.exports = { ApprovalStore, currentProjectId, resetGatewayApprovals };
