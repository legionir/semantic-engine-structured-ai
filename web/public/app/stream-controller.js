/*
|--------------------------------------------------------------------------
| Event stream
|--------------------------------------------------------------------------
|
| One EventSource per visible project. Each message is reduced and drawn in
| one batch; a snapshot is reduced in full and drawn once. Side effects an
| event asks for run for live events only.
*/

import { batch, REGIONS, state, touch } from "./store.js";
import { applySnapshot as reduceSnapshot, reduce } from "./runtime-state.js";
import { refreshSession } from "./history-controller.js";
import { loadSettings } from "./settings-controller.js";
import { projectRunSettled } from "./queue-controller.js";
import { refreshSystemWarnings } from "./system-view.js";
import { refreshInterrupted } from "./interrupted-controller.js";


/*
| The summary of every conversation (tabs, notifications) arrives beside
| the events and is not one of them: whoever shows it subscribes here, so
| this module does not depend on its readers.
*/
const summaryListeners = new Set();

export function onConversationSummary(listener) {

    summaryListeners.add(listener);

    return () => summaryListeners.delete(listener);
}


function applySummary(conversations) {

    for (const listener of summaryListeners) {
        listener(conversations);
    }
}


/*
| Side effects an event asks for. Run for live events only: a snapshot or
| a stored session is replayed to redraw the past, not to re-trigger it.
*/
function runEffects(effects) {

    for (const effect of effects) {

        if (effect.type === "runSettled") {
            projectRunSettled(effect.projectId);
        } else if (effect.type === "loadSettings") {
            loadSettings();
        } else if (effect.type === "refreshSession") {
            refreshSession(effect.id);
        } else if (effect.type === "systemChanged") {
            refreshSystemWarnings();
        } else if (effect.type === "refreshInterrupted") {
            refreshInterrupted();
        }
    }
}


/* one live event: reduce it, redraw what changed once, then run its effects */
function apply(event) {

    let result = null;

    batch(() => {

        if (state.reconnecting) {
            state.reconnecting = false;
            touch("run");
        }

        result = reduce(state, event);

        if (result.regions.size > 0) {
            touch(...result.regions);
        }
    });

    runEffects(result.effects);
}


/* a snapshot is reduced in full and drawn once */
function applySnapshot(snapshot) {

    batch(() => {
        reduceSnapshot(state, snapshot || {});
        touch(...REGIONS);
    });

}


function eventsUrl() {

    if (state.currentProjectId) {

        return `/api/events?projectId=${encodeURIComponent(state.currentProjectId)}`;
    }

    return "/api/events";
}


export function connect() {

    if (state.eventSource && typeof state.eventSource.close === "function") {

        try {
            state.eventSource.close();
        } catch {
            /* already closed */
        }
    }

    const source =
        new EventSource(eventsUrl());

    state.eventSource = source;

    source.onmessage = message => {

        /* a stream from a previous project must not draw into this one */
        if (state.eventSource !== source) {
            return;
        }

        let payload;

        try {
            payload = JSON.parse(message.data);
        } catch {
            return;
        }

        if (!payload || typeof payload !== "object") {
            return;
        }

        if (payload.type === "snapshot") {
            applySnapshot(payload.snapshot);
            applySummary(state.conversations);
            return;
        }

        if (payload.type === "conversations") {
            if (Array.isArray(payload.conversations)) applySummary(payload.conversations);
            return;
        }

        apply(payload);
    };

    source.onerror = () => {

        if (state.eventSource !== source) {
            return;
        }

        state.reconnecting = true;
        touch("run");
    };
}
