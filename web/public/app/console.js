/*
|--------------------------------------------------------------------------
| Console controller
|--------------------------------------------------------------------------
|
| The entry the page loads (through main.js). The console keeps no state of
| its own beyond what the runtime reports: events from the stream go
| through the reducer in runtime-state.js into the store (store.js), and
| the panels are views mounted on store regions that redraw themselves.
| The request/response flows live in one controller per feature
| (*-controller.js, project-*.js); this file wires index.html's controls
| to them and starts the console.
|
| Three things are deliberately modal rather than inline, because they
| interrupt: settings, an approval request, and the full detail of one
| executed call. They share the Modal service in modal.js.
*/

import { openSystem, refreshSystemWarnings } from "./system-view.js";
import { initInterrupted } from "./interrupted-controller.js";
import { initQuality } from "./quality-controller.js";
import { state, touch } from "./store.js";
import { mount } from "./dom.js";
import { Attachments } from "./composer-view.js";
import { approvals, el, failureText, notifyError, pushMessage } from "./console-core.js";
import { openHistory } from "./history-controller.js";
import { openMcp } from "./mcp-controller.js";
import { openDiscussion } from "./discussion-controller.js";
import { mountViews, openEventsModal, openExecutionModal, openPlanModal, toggleChatRawMode } from "./panels-controller.js";
import { changeApprovalMode, changeAutoContinue, loadSettings, openLlmSettings, openSettings } from "./settings-controller.js";
import { apiFetch } from "./auth-transport.js";
import { connect } from "./stream-controller.js";
import { initTaskDraft, removeAttachment, selectedReasoningEffort, submitCorrection, submitTask, writeTaskDraft } from "./composer-controller.js";
import { initConversations, toggleNotifications } from "./conversations-controller.js";
import { messageQueueActions, stopProjectQueue } from "./queue-controller.js";
import { QueuePanel } from "./queue-view.js";
import { mountDashboard } from "./projects-controller.js";
import { initProjects } from "./project-manager.js";
import { installPanelErrorReporting, openLogs, startLogBadge } from "./logs-controller.js";
import { openTerminal } from "./terminal-controller.js";
import { openFiles } from "./files-controller.js";
import { initMentions } from "./mention-controller.js";
import { initCommandPalette, openCommandPalette } from "./palette-controller.js";
import { loadPromptCommands, runPromptCommand } from "./mcp-commands.js";
import { executeSlashCommand, listCommands, registerCommand, registerCommandProvider } from "./slash-commands.js";
import { listTemplates } from "./task-templates.js";
import { seedSampleTemplates } from "./task-template-samples.js";
import { applyTemplateToComposer, closeTemplatesModal, loadTemplateByName, openTemplatesModal } from "./templates-controller.js";


function clearComposerInput() {

    const field = el("task");
    if (field) field.value = "";
    writeTaskDraft("");
}


async function submitComposerTask() {

    closeTemplatesModal();
    let task = el("task").value.trim();

    if (task === "" && state.attachments.length === 0) {
        return;
    }

    if (task.startsWith("/")) {
        const result = await executeSlashCommand(task, { source: "submit" });
        if (result.handled) {
            if (result.ok) {
                if (!result.value?.preserveInput) clearComposerInput();
            } else {
                notifyError(result.error);
            }
            return;
        }
    }

    if (task === "") {
        task = "Inspect the attached file(s) and determine the appropriate next step.";
    }

    await submitTask(task, selectedReasoningEffort());
}


async function cancelCurrentRun() {

    stopProjectQueue();
    state.stopPending = true;
    touch("run");

    /* the conversation on screen; the default view stops the run it shows */
    const projectId = state.currentProjectId || state.activeProjectId;
    const url = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/cancel`
        : "/api/cancel";

    try {
        const response = await apiFetch(url, { method: "POST" });
        if (!response.ok) throw new Error(`Stop request failed (${response.status}).`);
    } catch (error) {
        state.stopPending = false;
        touch("run");
        notifyError(error.message || "Stop request failed.");
    }
}


el("taskForm").addEventListener("submit", async submitEvent => {

    submitEvent.preventDefault();
    await submitComposerTask();
});


/* ------------------------------------------------------------- controls */

el("runButton").addEventListener("click", event => {

    if (state.status === "running") {
        event.preventDefault();
        void cancelCurrentRun();
    }
});

el("queueButton")?.addEventListener("click", () => {

    void submitComposerTask();
});


el("clearButton").addEventListener("click", async () => {

    try {
        /* a project's tab starts its own conversation afresh */
        const projectId = state.currentProjectId;
        const response = await apiFetch(
            projectId ? `/api/projects/${encodeURIComponent(projectId)}/clear` : "/api/clear",
            { method: "POST" }
        );
        if (!response.ok) {
            notifyError(await failureText(response, "The conversation was not cleared"));
            return;
        }
        state.turnsText = "0 turns";
        touch("header");
    } catch (error) {
        notifyError(`The conversation was not cleared: ${error.message || "network error"}`);
    }
});


el("autoContinue").addEventListener("change", event => changeAutoContinue(event.target.checked));
el("approvalMode").addEventListener("change", event => {
    const mode = event.target.value;
    if (mode === "plan") {
        state.composerPlanMode = true;
        touch("header");
        return;
    }
    state.composerPlanMode = false;
    touch("header");
    changeApprovalMode(mode);
});


el("settingsButton").addEventListener("click", openSettings);
el("llmSettingsButton").addEventListener("click", openLlmSettings);
el("planButton").addEventListener("click", openPlanModal);

const closeMobileMenu = () => {
    const header = el("consoleHeader");
    if (!header?.classList.contains("menu-open")) return;
    header.classList.remove("menu-open");
    el("mobileMenuToggle")?.setAttribute("aria-expanded", "false");
};

el("mobileMenuToggle").addEventListener("click", () => {
    const header = el("consoleHeader");
    const open = header.classList.toggle("menu-open");
    el("mobileMenuToggle").setAttribute("aria-expanded", String(open));
});

el("consoleMenu").addEventListener("click", event => {
    if (event.target.closest("button")) closeMobileMenu();
});

document.addEventListener("click", event => {
    if (!event.target.closest("#consoleHeader")) closeMobileMenu();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMobileMenu();
});

el("composerOptionsToggle")?.addEventListener("click", () => {
    const toggle = el("composerOptionsToggle");
    const composer = toggle?.closest(".composer");
    if (!composer) return;
    const open = composer.classList.toggle("options-open");
    toggle.setAttribute("aria-expanded", String(open));
});

el("commandPaletteButton")?.addEventListener("click", openCommandPalette);
el("mcpButton").addEventListener("click", openMcp);
el("logsButton").addEventListener("click", openLogs);
el("systemButton").addEventListener("click", openSystem);
el("terminalButton").addEventListener("click", openTerminal);
el("filesButton").addEventListener("click", openFiles);
el("historyButton").addEventListener("click", openHistory);
el("executionButton").addEventListener("click", openExecutionModal);
el("eventsButton").addEventListener("click", openEventsModal);
el("discussionButton").addEventListener("click", openDiscussion);
el("approvalsButton").addEventListener("click", () => approvals.open());
el("notificationsButton").addEventListener("click", toggleNotifications);
el("correctButton").addEventListener("click", submitCorrection);
el("chatFormatToggle")?.addEventListener("click", toggleChatRawMode);
el("templatesButton")?.addEventListener("click", openTemplatesModal);


el("task").addEventListener("keydown", event => {

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        el("taskForm").requestSubmit();
    }
});


function registerConsoleSlashCommands() {

    const builtins = [
        {
            name: "help",
            aliases: ["commands"],
            description: "List available slash commands",
            category: "General",
            execute: async () => {
                const items = await listCommands();
                const lines = items.map(cmd => `- \`${cmd.usage || `/${cmd.name}`}\` — ${cmd.description || cmd.category}`);
                pushMessage({ role: "assistant", kind: "message", content: `Available commands:\n${lines.join("\n")}`, at: Date.now() });
            }
        },
        { name: "palette", description: "Open searchable command palette", category: "Navigation", execute: () => openCommandPalette() },
        { name: "history", description: "Open saved conversations", category: "Navigation", execute: () => openHistory() },
        { name: "execution", description: "Open agent execution tree", category: "Navigation", execute: () => openExecutionModal() },
        { name: "events", description: "Open event stream log", category: "Navigation", execute: () => openEventsModal() },
        {
            name: "plan",
            description: "Open or focus the current plan",
            category: "Navigation",
            execute: () => {
                openPlanModal();
                if (!state.planModal) el("planPanel")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
            }
        },
        { name: "settings", description: "Open runtime settings", category: "Settings", execute: () => openSettings() },
        { name: "llm", description: "Open LLM provider settings", category: "Settings", execute: () => openLlmSettings() },
        { name: "mcp", description: "Open MCP servers dialog", category: "Integration", execute: () => openMcp() },
        { name: "logs", description: "Open application logs", category: "System", execute: () => openLogs() },
        { name: "system", description: "Open system resource monitor", category: "System", execute: () => openSystem() },
        { name: "terminal", aliases: ["term", "sh"], description: "Open system terminal", category: "Tools", execute: () => openTerminal() },
        { name: "files", description: "Browse and edit workspace files", category: "Tools", execute: () => openFiles() },
        { name: "discussion", description: "Open multi-agent discussion", category: "Actions", execute: () => openDiscussion() },
        { name: "changes", description: "Open workspace task changes", category: "Actions", execute: () => el("taskChangesButton")?.click() },
        { name: "review", description: "Open code review dialog", category: "Actions", execute: () => el("reviewButton")?.click() },
        { name: "projects", description: "Open project manager", category: "Projects", execute: () => el("projectsButton")?.click() },
        { name: "new-project", description: "Register or clone a new project", category: "Projects", execute: () => el("newProjectButton")?.click() },
        { name: "clear", aliases: ["new"], description: "Start a new conversation", category: "Actions", execute: () => el("clearButton")?.click() },
        {
            name: "stop",
            aliases: ["cancel"],
            description: "Stop the running task",
            category: "Actions",
            execute: () => {
                if (state.status === "running") return cancelCurrentRun();
                pushMessage({ role: "assistant", kind: "message", content: "No task is currently running.", at: Date.now() });
            }
        },
        {
            name: "mode",
            description: "Switch approval or plan mode (auto, prompt, deny, plan)",
            usage: "/mode <auto|prompt|deny|plan>",
            category: "Settings",
            acceptsArgs: true,
            execute: args => {
                const select = el("approvalMode");
                const allowed = ["auto", "prompt", "deny", "plan"];
                const next = String(args || "").trim().toLowerCase();
                if (!next) {
                    pushMessage({ role: "assistant", kind: "message", content: `Current mode: \`${select?.value || "auto"}\`. Usage: \`/mode <auto|prompt|deny|plan>\``, at: Date.now() });
                    return;
                }
                if (!allowed.includes(next)) throw new Error(`Unknown mode "${next}". Choose one of: ${allowed.join(", ")}.`);
                if (select) {
                    select.value = next;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
                pushMessage({ role: "assistant", kind: "message", content: `Mode switched to \`${next}\`.`, at: Date.now() });
            }
        },
        {
            name: "effort",
            description: "Set reasoning effort (inherit, low, medium, high, xhigh)",
            usage: "/effort <inherit|low|medium|high|xhigh>",
            category: "Settings",
            acceptsArgs: true,
            execute: args => {
                const select = el("taskEffort");
                const allowed = ["inherit", "low", "medium", "high", "xhigh"];
                const next = String(args || "").trim().toLowerCase();
                if (!next) {
                    pushMessage({ role: "assistant", kind: "message", content: `Current effort: \`${select?.value || "inherit"}\`. Usage: \`/effort <inherit|low|medium|high|xhigh>\``, at: Date.now() });
                    return;
                }
                if (!allowed.includes(next)) throw new Error(`Unknown effort "${next}". Choose one of: ${allowed.join(", ")}.`);
                if (select) {
                    select.value = next;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
                pushMessage({ role: "assistant", kind: "message", content: `Reasoning effort set to \`${next}\`.`, at: Date.now() });
            }
        },
        {
            name: "raw",
            aliases: ["markdown"],
            description: "Toggle raw text vs rendered Markdown preview in chat",
            category: "Navigation",
            execute: () => {
                const raw = toggleChatRawMode();
                pushMessage({
                    role: "assistant",
                    kind: "message",
                    content: `Chat response view switched to ${raw ? "raw text" : "rendered Markdown"}.`,
                    at: Date.now()
                });
            }
        },
        {
            name: "templates",
            aliases: ["tpl", "template"],
            description: "Open task templates or load a saved template by name",
            usage: "/templates [name]",
            category: "Tools",
            acceptsArgs: true,
            execute: args => {
                const query = String(args || "").trim();
                if (!query) {
                    openTemplatesModal();
                    return;
                }
                const loaded = loadTemplateByName(query);
                if (!loaded) {
                    throw new Error(`No saved template matches "${query}". Run /templates to manage templates.`);
                }
                return { preserveInput: true };
            }
        }
    ];

    for (const command of builtins) registerCommand(command);

    registerCommandProvider(async () => {
        const prompts = await loadPromptCommands();
        return prompts.map(prompt => ({
            name: `${prompt.server}:${prompt.name}`,
            type: "prompt",
            server: prompt.server,
            prompt,
            description: prompt.description || "MCP prompt",
            category: "MCP",
            acceptsArgs: Boolean(prompt.arguments?.length),
            execute: () => runPromptCommand(prompt)
        }));
    });

    /* first visit only: a starter set of templates (see task-template-samples.js) */
    seedSampleTemplates();

    registerCommandProvider(() => listTemplates().map(template => ({
        name: `tpl:${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || template.id}`,
        description: template.description || `Load template "${template.name}"`,
        category: "Templates",
        execute: () => {
            applyTemplateToComposer(template);
            return { preserveInput: true };
        }
    })));
}


mountViews();

mountDashboard();

mount(el("attachmentList"), () => Attachments({ state, onRemove: removeAttachment }), ["attachments", "settings"]);

initTaskDraft();

registerConsoleSlashCommands();

initMentions();

mount(el("messageQueue"), () => QueuePanel({ state, actions: messageQueueActions }), ["queue", "projects"]);

initConversations();

connect();

loadSettings();

initProjects();

startLogBadge();

initInterrupted();

initQuality();

refreshSystemWarnings();

installPanelErrorReporting();

initCommandPalette();

