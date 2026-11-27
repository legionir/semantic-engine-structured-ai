/*
|--------------------------------------------------------------------------
| Command palette controller
|--------------------------------------------------------------------------
|
| Searchable command palette allowing keyboard-driven and quick navigation
| across all views, modals, and actions in structured-ai.
| Triggered globally with Ctrl+K / Cmd+K or via the navigation bar.
|--------------------------------------------------------------------------
*/

import { el } from "./console-core.js";

export const COMMANDS = [
    { id: "historyButton", title: "History", subtitle: "Open saved conversations", category: "Navigation", keys: ["history", "conversations", "saved", "chat"] },
    { id: "executionButton", title: "Execution", subtitle: "Open agent execution tree and tool calls", category: "Navigation", keys: ["execution", "tree", "calls", "graph", "steps"] },
    { id: "eventsButton", title: "Events", subtitle: "Open event stream log", category: "Navigation", keys: ["events", "stream", "timeline", "log"] },
    { id: "planButton", title: "Plan", subtitle: "Open current execution plan and phases", category: "Navigation", keys: ["plan", "tasks", "phases", "goals"] },
    { id: "llmSettingsButton", title: "LLM Settings", subtitle: "Configure model providers, layers, and proxy", category: "Settings", keys: ["llm", "models", "proxy", "keys", "providers", "ai"] },
    { id: "mcpButton", title: "MCP Servers", subtitle: "Connect and inspect Model Context Protocol servers", category: "Integration", keys: ["mcp", "servers", "tools", "catalog", "registry"] },
    { id: "logsButton", title: "Logs", subtitle: "View application logs and AI errors", category: "System", keys: ["logs", "errors", "crashes", "diagnostics"] },
    { id: "systemButton", title: "System", subtitle: "Inspect CPU, memory, processes, and runtime state", category: "System", keys: ["system", "cpu", "memory", "ram", "metrics", "resources"] },
    { id: "terminalButton", title: "Terminal", subtitle: "Open system terminal inside workspace", category: "Tools", keys: ["terminal", "shell", "bash", "console", "cli"] },
    { id: "filesButton", title: "Files", subtitle: "Browse, view, and edit workspace files", category: "Tools", keys: ["files", "workspace", "code", "browser", "editor"] },
    { id: "notificationsButton", title: "Notifications", subtitle: "Toggle background browser notifications", category: "Settings", keys: ["notifications", "notify", "alert", "bell"] },
    { id: "logoutButton", title: "Sign Out", subtitle: "Sign out of the console on this browser", category: "Account", keys: ["sign out", "logout", "log out", "exit", "leave"] },
    { id: "settingsButton", title: "Settings", subtitle: "Open runtime and agent configuration", category: "Settings", keys: ["settings", "config", "preferences", "options"] },
    { id: "approvalsButton", title: "Approvals", subtitle: "Review and respond to pending tool approvals", category: "Actions", keys: ["approvals", "pending", "confirm", "allow", "deny"] },
    { id: "discussionButton", title: "Discussion", subtitle: "Start multi-agent deliberation and synthesis", category: "Actions", keys: ["discussion", "deliberate", "personas", "multi-agent"] },
    { id: "taskChangesButton", title: "Changes", subtitle: "Review workspace file changes made by tasks", category: "Actions", keys: ["changes", "diff", "revert", "git"] },
    { id: "reviewButton", title: "Review", subtitle: "Run automated code review on current diff", category: "Actions", keys: ["review", "audit", "lint", "inspect"] },
    { id: "clearButton", title: "New Conversation", subtitle: "Start a fresh conversation and reset state", category: "Actions", keys: ["new", "clear", "reset", "fresh"] },
    { id: "projectsButton", title: "Projects", subtitle: "Manage workspaces and switch active project", category: "Projects", keys: ["projects", "switch", "workspaces"] },
    { id: "newProjectButton", title: "New Project", subtitle: "Register a local folder or clone from git", category: "Projects", keys: ["new project", "clone", "git", "register"] },
    { id: "runButton", title: "Run Task / Cancel", subtitle: "Execute current prompt or cancel running turn", category: "Actions", keys: ["run", "execute", "stop", "cancel", "submit"] },
    { id: "attachFilesButton", title: "Attach Files", subtitle: "Attach files or images to next task", category: "Actions", keys: ["attach", "upload", "files", "screenshot"] },
    { id: "templatesButton", title: "Task Templates", subtitle: "Save and load reusable task descriptions", category: "Tools", keys: ["templates", "prompts", "snippets", "saved", "reuse"] },
    { id: "skillsButton", title: "Skills", subtitle: "Browse every skill and choose which are sent to the AI", category: "Tools", keys: ["skills", "persona", "audit", "skill", "library"] },
    { id: "chatFormatToggle", title: "Toggle Raw / Markdown View", subtitle: "Switch agent responses between rendered Markdown and raw text", category: "Navigation", keys: ["raw", "markdown", "preview", "format", "toggle"] }
];

let activeModal = null;

export function isCommandPaletteOpen() {
    return Boolean(activeModal && activeModal.isOpen());
}

export function closeCommandPalette() {
    if (activeModal && activeModal.isOpen()) {
        activeModal.close("dismiss");
    }
    activeModal = null;
}

export function executeCommand(cmd) {
    closeCommandPalette();
    const target = el(cmd.id);
    if (target) {
        target.click();
    }
    if (cmd.id === "planButton" && typeof window !== "undefined" && Number(window.innerWidth || 0) > 900) {
        el("planPanel")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
}

export function openCommandPalette() {
    if (isCommandPaletteOpen()) {
        closeCommandPalette();
        return null;
    }

    const container = document.createElement("div");
    container.className = "palette-body";

    const searchWrapper = document.createElement("div");
    searchWrapper.className = "palette-search-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "palette-input";
    input.placeholder = "Type a command or search views… (Ctrl+K)";
    input.setAttribute("aria-label", "Search commands");
    input.autocomplete = "off";
    input.spellcheck = false;
    searchWrapper.appendChild(input);

    const meta = document.createElement("div");
    meta.className = "palette-meta";
    const countSpan = document.createElement("span");
    countSpan.className = "palette-count";
    const helpSpan = document.createElement("span");
    helpSpan.className = "palette-help";

    const kbdUp = document.createElement("kbd");
    kbdUp.textContent = "↑";
    const kbdDown = document.createElement("kbd");
    kbdDown.textContent = "↓";
    const kbdEnter = document.createElement("kbd");
    kbdEnter.textContent = "↵";
    const kbdEsc = document.createElement("kbd");
    kbdEsc.textContent = "Esc";

    helpSpan.append(
        kbdUp,
        kbdDown,
        document.createTextNode(" navigate "),
        kbdEnter,
        document.createTextNode(" select "),
        kbdEsc,
        document.createTextNode(" close")
    );
    meta.append(countSpan, helpSpan);

    const list = document.createElement("ul");
    list.className = "palette-list";
    list.setAttribute("role", "listbox");

    const empty = document.createElement("div");
    empty.className = "palette-empty";
    empty.hidden = true;

    container.append(searchWrapper, meta, list, empty);

    function visibleCommands() {
        return COMMANDS.filter(cmd => {
            if (cmd.id === "approvalsButton" && el("approvalsButton")?.hidden) return false;
            return true;
        });
    }

    let filtered = visibleCommands();
    let selectedIndex = 0;

    function select(index) {
        const items = list.querySelectorAll(".palette-item");
        if (!items.length) {
            selectedIndex = 0;
            return;
        }
        if (index < 0) index = items.length - 1;
        if (index >= items.length) index = 0;
        selectedIndex = index;
        items.forEach((item, i) => {
            const active = i === selectedIndex;
            item.classList.toggle("active", active);
            item.setAttribute("aria-selected", String(active));
            if (active) {
                item.scrollIntoView({ block: "nearest" });
            }
        });
    }

    function render() {
        const query = input.value.trim().toLowerCase();
        filtered = visibleCommands().filter(cmd => {
            if (!query) return true;
            return cmd.title.toLowerCase().includes(query) ||
                cmd.subtitle.toLowerCase().includes(query) ||
                cmd.category.toLowerCase().includes(query) ||
                (cmd.keys && cmd.keys.some(k => k.toLowerCase().includes(query)));
        });

        list.replaceChildren();
        countSpan.textContent = `${filtered.length} command${filtered.length === 1 ? "" : "s"}`;

        if (filtered.length === 0) {
            empty.textContent = `No commands match "${input.value.trim()}"`;
            empty.hidden = false;
            return;
        }

        empty.hidden = true;
        filtered.forEach((cmd, idx) => {
            const li = document.createElement("li");
            li.className = "palette-item" + (idx === 0 ? " active" : "");
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", idx === 0 ? "true" : "false");
            li.dataset.index = String(idx);

            const main = document.createElement("div");
            main.className = "palette-item-main";

            const title = document.createElement("span");
            title.className = "palette-item-title";
            title.textContent = cmd.title;

            const subtitle = document.createElement("span");
            subtitle.className = "palette-item-subtitle";
            subtitle.textContent = cmd.subtitle;

            main.append(title, subtitle);

            const badge = document.createElement("span");
            badge.className = "palette-item-badge chip";
            badge.textContent = cmd.category;

            li.append(main, badge);

            li.addEventListener("mousemove", () => {
                select(idx);
            });

            li.addEventListener("click", () => {
                executeCommand(cmd);
            });

            list.appendChild(li);
        });

        select(0);
    }

    input.addEventListener("input", render);

    input.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            select(selectedIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            select(selectedIndex - 1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (filtered[selectedIndex]) {
                executeCommand(filtered[selectedIndex]);
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeCommandPalette();
        }
    });

    render();

    const handle = Modal.open({
        title: "Command Palette",
        subtitle: "Quick search for views, modals, and actions",
        size: "medium",
        className: "palette-modal",
        body: container,
        onClose: () => {
            activeModal = null;
        }
    });

    activeModal = handle;
    setTimeout(() => input.focus(), 30);
    return handle;
}

export function initCommandPalette() {
    document.addEventListener("keydown", event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            openCommandPalette();
        }
    });
}
