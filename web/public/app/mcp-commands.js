/*
|--------------------------------------------------------------------------
| MCP prompts as commands, and a server's questions (roadmap P4-10)
|--------------------------------------------------------------------------
|
| Typing / in the composer lists the prompts of the connected servers;
| choosing one asks for its arguments and puts the rendered text in the
| message box (mention-controller.js draws the list).
|
| An MCP server may ask the operator something (elicitation): a dialog
| outside the MCP modal answers it. The stream may carry only the type of
| an MCP event (an event of no project reaches a project stream as
| metadata), so every mcp:* event is a cue to ask what is pending.
|--------------------------------------------------------------------------
*/


import { noticeDialog } from "./operator-api.js";
import { apiFetch } from "./auth-transport.js";

export async function request(url, options = {}) {

    let response;

    try {
        response = await apiFetch(url, {
            ...options,
            headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
        });
    } catch (error) {
        return { ok: false, status: 0, error: error.message || "network error", payload: {} };
    }

    const payload = await response.json().catch(() => ({}));

    return response.ok
        ? { ok: true, status: response.status, payload }
        : { ok: false, status: response.status, error: payload.error || `request failed (${response.status})`, payload };
}


/* the answer of an elicitation form, typed as the schema says */
export function coerceAnswer(schema, values) {

    const content = {};

    for (const [name, property] of Object.entries((schema && schema.properties) || {})) {

        const raw = values[name];

        if (property.type === "boolean") {
            content[name] = raw === true || raw === "true" || raw === "on";
            continue;
        }

        if (raw === undefined || raw === null || raw === "") continue;

        content[name] = property.type === "number" || property.type === "integer" ? Number(raw) : String(raw);
    }

    return content;
}


/* ------------------------------------------------- prompts as commands */

let promptIndex = { at: 0, items: [] };


export async function loadPromptCommands(force = false) {

    if (!force && Date.now() - promptIndex.at < 30000) return promptIndex.items;

    const result = await request("/api/mcp/prompts");

    promptIndex = {
        at: Date.now(),
        items: result.ok ? (result.payload.prompts || []) : []
    };

    return promptIndex.items;
}


function insertIntoComposer(text) {

    const textarea = document.getElementById("task");

    if (!textarea) return;

    textarea.value = textarea.value.trim() ? `${textarea.value.replace(/\s+$/, "")}\n\n${text}` : text;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}


export async function runPromptCommand(prompt) {

    const render = async values => {
        const result = await request(`/api/mcp/${encodeURIComponent(prompt.server)}/prompts/${encodeURIComponent(prompt.name)}`, {
            method: "POST",
            body: JSON.stringify({ arguments: values })
        });
        if (!result.ok) throw new Error(result.error);
        insertIntoComposer(result.payload.text || "");
    };

    const args = prompt.arguments || [];

    if (args.length === 0 || typeof Modal === "undefined") {
        try {
            await render({});
        } catch (error) {
            await noticeDialog(error.message, { title: "MCP prompt failed" });
        }
        return;
    }

    const form = document.createElement("form");
    form.className = "mcp-prompt-form";

    for (const argument of args) {
        const label = document.createElement("label");
        label.className = "mcp-field";
        const caption = document.createElement("span");
        caption.className = "label";
        caption.textContent = `${argument.name}${argument.required ? " *" : ""}`;
        const input = document.createElement("input");
        input.name = argument.name;
        input.required = argument.required === true;
        input.placeholder = argument.description || "";
        label.append(caption, input);
        form.append(label);
    }

    const message = document.createElement("p");
    message.className = "mcp-message";
    form.append(message);

    const submit = async () => {
        if (!form.reportValidity()) return;
        const values = Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => value !== ""));
        try {
            await render(values);
            handle.close("done");
        } catch (error) {
            message.textContent = error.message;
        }
    };

    form.addEventListener("submit", event => { event.preventDefault(); void submit(); });

    const handle = Modal.open({
        title: `/${prompt.server}:${prompt.name}`,
        subtitle: prompt.description || "MCP prompt",
        size: "small",
        body: form,
        footer: Modal.row(
            Modal.button("Cancel", "ghost", () => handle.close("cancel")),
            Modal.button("Insert", "", () => void submit())
        )
    });

    form.querySelector("input")?.focus();
}


/* ------------------------------------------------ elicitation (P4-10) */

const shownElicitations = new Map();
let elicitationTimer = null;


function elicitationForm(item) {

    const form = document.createElement("form");
    form.className = "mcp-elicitation";

    const question = document.createElement("p");
    question.textContent = item.message;
    form.append(question);

    const required = new Set((item.schema && item.schema.required) || []);

    for (const [name, property] of Object.entries((item.schema && item.schema.properties) || {})) {

        const label = document.createElement("label");
        label.className = "mcp-field";

        const caption = document.createElement("span");
        caption.className = "label";
        caption.textContent = `${property.title || name}${required.has(name) ? " *" : ""}`;
        label.append(caption);

        let input;

        if (Array.isArray(property.enum)) {
            input = document.createElement("select");
            for (const [index, value] of property.enum.entries()) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = (property.enumNames && property.enumNames[index]) || value;
                input.append(option);
            }
        } else if (property.type === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = property.default === true;
        } else {
            input = document.createElement("input");
            input.type = property.type === "number" || property.type === "integer" ? "number" : property.format === "email" ? "email" : "text";
            if (property.default !== undefined) input.value = property.default;
            if (property.minimum !== undefined) input.min = property.minimum;
            if (property.maximum !== undefined) input.max = property.maximum;
            if (property.maxLength !== undefined) input.maxLength = property.maxLength;
            input.required = required.has(name);
        }

        input.name = name;
        label.append(input);

        if (property.description) {
            const hint = document.createElement("span");
            hint.className = "muted";
            hint.textContent = property.description;
            label.append(hint);
        }

        form.append(label);
    }

    const message = document.createElement("p");
    message.className = "mcp-message";
    form.append(message);

    return { form, message };
}


function readElicitation(form, schema) {

    const values = {};

    for (const name of Object.keys((schema && schema.properties) || {})) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        values[name] = field.type === "checkbox" ? field.checked : field.value;
    }

    return coerceAnswer(schema, values);
}


function showElicitation(item) {

    if (shownElicitations.has(item.id) || typeof Modal === "undefined") return;

    const { form, message } = elicitationForm(item);

    const answer = async action => {

        if (action === "accept" && !form.reportValidity()) return;

        const result = await request(`/api/mcp/elicitations/${encodeURIComponent(item.id)}`, {
            method: "POST",
            body: JSON.stringify(action === "accept" ? { action, content: readElicitation(form, item.schema) } : { action })
        });

        if (!result.ok && result.status !== 404) {
            message.textContent = result.error;
            return;
        }

        handle.close("answered");
    };

    form.addEventListener("submit", event => { event.preventDefault(); void answer("accept"); });

    const handle = Modal.open({
        title: `${item.server} asks`,
        subtitle: "An MCP server needs an answer to continue. Do not enter passwords or secrets here.",
        size: "small",
        body: form,
        footer: Modal.row(
            Modal.button("Decline", "ghost", () => void answer("decline")),
            Modal.button("Cancel", "ghost", () => void answer("cancel")),
            Modal.button("Send", "", () => void answer("accept"))
        ),
        onClose: reason => {
            shownElicitations.delete(item.id);
            /* closed with Escape or the ×: the server hears "cancel" */
            if (reason !== "answered" && reason !== "resolved") {
                void request(`/api/mcp/elicitations/${encodeURIComponent(item.id)}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
            }
        }
    });

    shownElicitations.set(item.id, handle);
    form.querySelector("input, select")?.focus();
}


export async function syncElicitations() {

    const result = await request("/api/mcp/elicitations");

    if (!result.ok) return;

    const pending = result.payload.elicitations || [];
    const ids = new Set(pending.map(item => item.id));

    for (const [id, handle] of shownElicitations) {
        if (!ids.has(id)) {
            shownElicitations.delete(id);
            handle.close("resolved");
        }
    }

    for (const item of pending) showElicitation(item);
}


/*
| The stream hook: every mcp:* event. Progress with its details updates the
| running server's bar; anything about elicitation re-reads what is
| pending (debounced); an OAuth change refreshes the open panel.
*/
export function handleMcpEvent(event, { state, touch, refreshMcp } = {}) {

    if (!event || typeof event.type !== "string" || !event.type.startsWith("mcp:")) return false;

    if (event.type === "mcp:elicitation" || event.type === "mcp:elicitation_resolved") {
        clearTimeout(elicitationTimer);
        elicitationTimer = setTimeout(() => void syncElicitations(), 50);
        return true;
    }

    if (event.type === "mcp:progress" && state && event.server) {
        if (!state.mcp.progress) state.mcp.progress = new Map();
        const done = Number.isFinite(event.total) && event.progress >= event.total;
        if (done) state.mcp.progress.delete(event.server);
        else state.mcp.progress.set(event.server, { progress: event.progress, total: event.total, message: event.message, at: Date.now() });
        touch && touch("mcp");
        return true;
    }

    if (event.type === "mcp:oauth" && state && state.mcpModal && refreshMcp) {
        void refreshMcp(false);
        return true;
    }

    return true;
}
