/*
|--------------------------------------------------------------------------
| Run Budget
|--------------------------------------------------------------------------
|
| The two per-run budgets the engine enforces:
|
| RunBudget — the wall-clock budget. It holds the run's start timestamp
| and the hook-timing fields (a hook swaps the effective deadline while
| it executes), and derives deadline/remaining/elapsed from them. The
| deadline is derived, never stored beyond these inputs, so a limit
| changed mid-run still moves the deadline of a run that is already
| going — the same semantics as the legacy RUN fields these back.
|
| AgentSpawnBudget — the sub-agent budget (the legacy AGENT_BUDGET
| counter): how many agents this single run may spawn across every depth
| and branch of its delegation tree.
|--------------------------------------------------------------------------
*/

class RunBudget {

    constructor() {

        this.startedAt = 0;

        /* Hook executors borrow the run's deadline while a hook runs. */
        this.inHook = false;

        this.hookPhase = null;

        this.hookStartedAt = 0;

        this.hookDeadlineAt = null;

    }


    /* Mirrors agent.js runDeadlineAt(): hook deadline wins, then the
       start plus the run limit, and nothing before the run has started. */
    deadlineAt(maxRunMs) {

        if (this.inHook && this.hookDeadlineAt) {
            return this.hookDeadlineAt;
        }

        if (!this.startedAt) {
            return null;
        }

        return this.startedAt + maxRunMs;

    }


    remainingMs(maxRunMs) {

        const deadline = this.deadlineAt(maxRunMs);

        if (!deadline) {
            return maxRunMs;
        }

        return deadline - Date.now();

    }


    elapsedMs() {

        return (
            this.startedAt
                ? Date.now() - this.startedAt
                : 0
        );

    }

}


class AgentSpawnBudget {

    constructor() {

        this.spawned = 0;

    }


    reset() {

        this.spawned = 0;

    }


    remaining(maxTotalAgents) {

        return Math.max(
            0,
            maxTotalAgents - this.spawned
        );

    }


    /* Consume one slot; overshooting the limit is an error, not a warn. */
    consume(maxTotalAgents, agentName) {

        this.spawned++;

        if (this.spawned > maxTotalAgents) {

            throw new Error(
                `Total agent budget exceeded (${maxTotalAgents}) while starting "${agentName}".`
            );

        }

    }

}


/*
| What a run has cost (roadmap P3-05): tokens and dollars summed over every
| model response, against an optional dollar cap. maxUsd null means "use
| MAX_RUN_COST_USD", 0 means no cap. A response from a model without a
| price adds tokens but no dollars and is listed in `unpriced`, so a cap
| that cannot be enforced is visible instead of silently passing.
*/
class RunCost {

    constructor({ maxUsd = null } = {}) {

        const cap = Number(maxUsd);

        this.maxUsd = maxUsd === null || maxUsd === undefined || !Number.isFinite(cap) || cap < 0 ? null : cap;
        this.totalUsd = 0;
        this.promptTokens = 0;
        this.completionTokens = 0;
        this.cachedTokens = 0;
        this.requests = 0;
        this.unpriced = new Set();
        this.capReached = false;

    }


    /* the cap in force: the run's own, else the setting; 0 = none */
    cap(settingValue = 0) {

        const value = this.maxUsd === null ? Number(settingValue) : this.maxUsd;

        return Number.isFinite(value) && value > 0 ? value : 0;

    }


    /* adds one response's costOf() result; returns true when the cap is now reached */
    add(model, entry, settingValue = 0) {

        this.requests += 1;
        this.promptTokens += entry.prompt_tokens || 0;
        this.completionTokens += entry.completion_tokens || 0;
        this.cachedTokens += entry.cached_tokens || 0;

        if (entry.priced) {
            this.totalUsd += entry.cost_usd;
        } else if (model) {
            this.unpriced.add(String(model));
        }

        const cap = this.cap(settingValue);

        return cap > 0 && this.totalUsd >= cap;

    }


    snapshot(settingValue = 0) {

        return {
            cost_usd: Math.round(this.totalUsd * 1e6) / 1e6,
            max_cost_usd: this.cap(settingValue) || null,
            prompt_tokens: this.promptTokens,
            completion_tokens: this.completionTokens,
            cached_tokens: this.cachedTokens,
            requests: this.requests,
            unpriced_models: [...this.unpriced]
        };

    }

}


module.exports = {
    RunBudget,
    AgentSpawnBudget,
    RunCost
};
