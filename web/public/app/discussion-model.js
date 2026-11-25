/*
| Discussion state. The live stream and a reload both end up in the same
| state.discussion object, and one view draws it, so the transcript reads
| the same whether it was watched live or reopened later.
*/

export function reduceDiscussion(state, event) {

    const discussion = state.discussion;

    /* a discussion may be started from the CLI: the first start adopts it,
       a second, different one is ignored while the first is running */
    if (event.type === "discussion:start") {

        if (!discussion || discussion.status !== "running") {

            state.discussion = {
                id: event.id,
                status: "running",
                task: event.task,
                personas: event.personas || [],
                max_rounds: event.max_rounds,
                rounds: [],
                observer_decisions: [],
                final_report: null
            };

        } else if (discussion.id && event.id && discussion.id !== event.id) {
            return false;
        }

        return true;
    }

    if (!discussion) {
        return false;
    }

    switch (event.type) {

        case "discussion:message": {

            let round = discussion.rounds.find(item => item.round === event.round);

            if (!round) {
                round = { round: event.round, messages: [] };
                discussion.rounds.push(round);
                discussion.rounds.sort((a, b) => a.round - b.round);
            }

            round.messages.push({
                persona: event.persona,
                persona_name: event.persona_name,
                content: event.content,
                round: event.round
            });

            return true;
        }

        case "discussion:observer":
            discussion.observer_decisions.push(event);
            return true;

        case "discussion:round":
            return true;

        case "discussion:finish":
            discussion.status = "done";
            discussion.total_rounds = event.total_rounds;
            discussion.hit_max_rounds = event.hit_max_rounds;
            discussion.stopped_reason = event.stopped_reason || null;
            discussion.final_report = event.final_report;
            return true;

        case "discussion:error":
            discussion.status = "failed";
            discussion.error = event.error;
            return true;

        default:
            return false;
    }
}


export function discussionStatusLine(discussion) {

    if (!discussion) {
        return "no discussion yet";
    }

    if (discussion.status === "running") {

        const round =
            discussion.rounds && discussion.rounds.length
                ? `round ${discussion.rounds.length} of ${discussion.max_rounds}`
                : "starting";

        return `${round} · ${(discussion.personas || []).length} personas`;
    }

    if (discussion.status === "done") {
        return `done · ${discussion.total_rounds} round(s)${discussion.hit_max_rounds ? " · max rounds reached" : ""}`;
    }

    return `failed · ${discussion.error || "unknown error"}`;
}


/*
| One canonical reading order: each round's messages followed by the
| observer's decision on that round, then any decision without a round,
| the error, and the final report.
*/
export function discussionTimeline(discussion) {

    const items = [];
    const decisions = [...(discussion.observer_decisions || [])];
    const used = new Set();

    for (const round of discussion.rounds || []) {

        items.push({ type: "round", key: `r${round.round}`, round: round.round });

        (round.messages || []).forEach((message, index) => {
            items.push({ type: "message", key: `m${round.round}-${index}`, message });
        });

        decisions.forEach((decision, index) => {
            if (!used.has(index) && decision.round === round.round) {
                used.add(index);
                items.push({ type: "observer", key: `o${index}`, decision });
            }
        });
    }

    decisions.forEach((decision, index) => {
        if (!used.has(index)) items.push({ type: "observer", key: `o${index}`, decision });
    });

    if (discussion.status === "failed" && discussion.error) {
        items.push({ type: "error", key: "error", error: discussion.error });
    }

    if (discussion.final_report) {
        items.push({ type: "report", key: "report", report: discussion.final_report });
    }

    return items;
}
