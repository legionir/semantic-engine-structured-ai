/*
|--------------------------------------------------------------------------
| Console settings-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The settings modal: rows grouped the way the schema groups them, per-row
| validation, and the apply-live answer the server reports back.
|--------------------------------------------------------------------------
*/

import { Modal, node } from "./dom.js";
import { loadSettings } from "./api.js";
import { settingsState } from "./store.js";

export const GROUP_ORDER = [
    "endpoint",
    "endpoint.main", "endpoint.l1", "endpoint.l2", "endpoint.l3", "endpoint.summary",
    "memory", "archive", "journal", "context", "budget", "delegation", "planning", "hooks",
    "persistence", "policy", "tools", "mcp", "output", "workspace"
];

export function settingsBody(list) {

    const container = node("div", "settings");

    const search = node("input", "filter");

    search.type = "search";
    search.placeholder = "filter settings";

    container.appendChild(search);

    const groups = new Map();

    for (const setting of list) {

        if (!groups.has(setting.group)) {
            groups.set(setting.group, []);
        }

        groups.get(setting.group).push(setting);
    }

    const ordered =
        [...groups.keys()].sort(
            (a, b) =>
                GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)
        );

    for (const name of ordered) {

        const section = node("div", "group");

        section.appendChild(node("h3", null, name));

        for (const setting of groups.get(name)) {

            section.appendChild(settingRow(setting));
        }

        container.appendChild(section);
    }

    search.addEventListener("input", () => {

        const term =
            search.value.trim().toLowerCase();

        for (const section of container.querySelectorAll(".group")) {

            let visible = 0;

            for (const row of section.querySelectorAll(".setting")) {

                const match =
                    term === "" ||
                    row.dataset.key.toLowerCase().includes(term) ||
                    (row.dataset.hint || "").includes(term);

                row.hidden = !match;

                visible += match ? 1 : 0;
            }

            section.hidden = visible === 0;
        }
    });

    return container;
}

export function settingRow(setting) {

    const row = node("div", "setting");

    row.dataset.key = setting.key;
    row.dataset.hint = (setting.description || "").toLowerCase();

    const label = node("div");

    label.append(
        node("div", "label", setting.key),
        node(
            "div",
            "hint",
            `${setting.description}${
                setting.fixed
                    ? " (fixed at startup)"
                    : ""
            }`
        )
    );

    let input;

    if (setting.type === "boolean" || setting.type === "enum") {

        input = node("select");

        const values =
            setting.type === "boolean"
                ? ["true", "false"]
                : setting.values;

        for (const option of values) {

            const element = node("option", null, option);

            element.value = option;

            input.appendChild(element);
        }

        input.value = String(setting.value);

    } else {

        input = node("input");

        input.type =
            setting.type === "number"
                ? "number"
                : "text";

        if (setting.min !== undefined) {
            input.min = setting.min;
        }

        if (setting.max !== undefined) {
            input.max = setting.max;
        }

        input.value =
            setting.value === null
                ? ""
                : setting.value;
    }

    input.disabled = setting.fixed;

    input.addEventListener("change", async () => {

        const response =
            await fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: setting.key,
                    value: input.value
                })
            });

        const payload =
            await response.json();

        if (!response.ok) {

            input.value = setting.value;

            row.classList.add("rejected");

            row.querySelector(".hint").textContent = payload.error;

            return;
        }

        row.classList.add("saved");

        setTimeout(
            () => row.classList.remove("saved"),
            800
        );

        loadSettings();
    });

    const source = node("span", `src ${setting.source}`, setting.source);

    source.title =
        setting.source === "override"
            ? "changed here, click to restore"
            : setting.source;

    if (setting.source === "override" && !setting.fixed) {

        source.style.cursor = "pointer";

        source.onclick = async () => {

            await fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    key: setting.key,
                    reset: true
                })
            });

            loadSettings();
        };
    }

    row.append(label, input, source);

    return row;
}

export function openSettings() {

    if (settingsState.settingsModal && settingsState.settingsModal.isOpen()) {
        return;
    }

    settingsState.settingsModal =
        Modal.open({
            title: "Settings",
            subtitle: "applied on next use, no restart",
            size: "large",
            body: settingsBody(settingsState.settings),

            footer:
                Modal.row(
                    Modal.button(
                        "Reload",
                        "ghost",
                        () => loadSettings()
                    ),
                    Modal.button(
                        "Close",
                        "",
                        () => settingsState.settingsModal.close("footer")
                    )
                ),

            onClose: () => {

                settingsState.settingsModal = null;
            }
        });

    loadSettings();
}
