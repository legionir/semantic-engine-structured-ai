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


module.exports = {
    RunBudget,
    AgentSpawnBudget
};
