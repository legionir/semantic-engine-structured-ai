/*
|--------------------------------------------------------------------------
| Console mcp-view (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| The MCP panel: server rows with their state, the add form, enable and remove,
| and the body that keeps the modal open across a refresh.
|
| The form posts the shape the server's policy expects; refusals come back as the
| server's own 403/404/400 rather than something invented here.
|--------------------------------------------------------------------------
*/

import { Modal, node } from "./dom.js";
import { mcpState } from "./store.js";

/*
| The servers this runtime can reach, and the tools they offer. A server
| is either connected, refused, or switched off, and the panel says
| which without making the operator read a log to find out.
*/

export function mcpStateLabel(server) {

    if (!server.enabled) {
        return "off";
    }

    return {
        ready: "connected",
        idle: "not contacted yet",
        connecting: "connecting",
        failed: "unreachable",
        closed: "closed"
    }[server.state] || server.state;
}

export function mcpServerRow(server, refresh) {

    const row = node("div", `mcp-server ${server.enabled ? server.state : "off"}`);

    const head = node("div", "mcp-head");

    head.append(
        node("span", "name", server.name),
        node("span", "chip", server.transport),
        node("span", `state ${server.enabled ? server.state : "off"}`, mcpStateLabel(server))
    );

    if (server.builtin) {
        head.appendChild(node("span", "chip", "built-in"));
    }

    row.appendChild(head);

    const facts = [];

    if (server.server && server.server.name) {
        facts.push(`${server.server.name} ${server.server.version || ""}`.trim());
    }

    if (server.connection && server.connection.url) {
        facts.push(server.connection.url);
    }

    if (server.connection && server.connection.command) {
        facts.push(
            [server.connection.command, ...(server.connection.args || [])].join(" ")
        );
    }

    facts.push(`${server.tool_count} tool${server.tool_count === 1 ? "" : "s"}`);

    if (server.stats && server.stats.calls) {
        facts.push(`${server.stats.calls} call${server.stats.calls === 1 ? "" : "s"}`);
    }

    row.appendChild(node("div", "facts", facts.join(" · ")));

    if (server.error) {
        row.appendChild(node("div", "mcp-error", server.error));
    }

    const actions = node("div", "mcp-actions");

    actions.append(
        Modal.button(
            server.enabled ? "Disable" : "Enable",
            "ghost",
            async () => {

                await fetch(
                    `/api/mcp/${encodeURIComponent(server.name)}/enabled`,
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ enabled: !server.enabled })
                    }
                );

                refresh();
            }
        ),
        Modal.button(
            "Remove",
            "ghost danger",
            async () => {

                await fetch(
                    `/api/mcp/${encodeURIComponent(server.name)}`,
                    { method: "DELETE" }
                );

                refresh();
            }
        )
    );

    row.appendChild(actions);

    return row;
}

export function mcpAddForm(refresh) {

    const form = node("div", "mcp-add");

    form.appendChild(node("h3", null, "Connect a server"));

    const fields = {};

    const field = (key, label, placeholder) => {

        const wrapper = node("label", "mcp-field");

        wrapper.appendChild(node("span", "label", label));

        const input = node("input");

        input.type = "text";
        input.placeholder = placeholder || "";

        wrapper.appendChild(input);

        fields[key] = input;

        form.appendChild(wrapper);

        return input;
    };

    const transportWrapper = node("label", "mcp-field");

    transportWrapper.appendChild(node("span", "label", "transport"));

    const transport = node("select");

    for (const value of ["stdio", "http", "sse", "websocket"]) {

        const option = node("option", null, value);

        option.value = value;

        transport.appendChild(option);
    }

    transportWrapper.appendChild(transport);

    form.appendChild(transportWrapper);

    field("name", "name", "github");
    field("command", "command", "npx (stdio only)");
    field("command_args", "arguments", "-y @modelcontextprotocol/server-github");
    field("url", "url", "https://host/mcp (http, sse, websocket)");
    field("token", "token", "bearer token, optional");

    // env field for stdio transport
    const envWrapper = node("label", "mcp-field");
    envWrapper.appendChild(node("span", "label", "env (JSON or KEY=VALUE lines)"));
    const envInput = node("textarea");
    envInput.placeholder = '{"GITHUB_TOKEN":"${env:GITHUB_TOKEN}"} or\\nGITHUB_TOKEN=ghp_xxx\\nNODE_ENV=production';
    envInput.rows = 3;
    envInput.style.width = "100%";
    envInput.style.resize = "vertical";
    envInput.style.fontFamily = "monospace";
    envWrapper.appendChild(envInput);
    fields.env = envInput;
    form.appendChild(envWrapper);

    const message = node("p", "mcp-message");

    form.appendChild(message);

    /*
    | A stdio server wants a command, a remote one wants a url, and
    | showing both at once is how an operator fills in the wrong one.
    */

    const applyTransport = () => {

        const local = transport.value === "stdio";

        fields.command.parentElement.hidden = !local;
        fields.command_args.parentElement.hidden = !local;
        fields.env.parentElement.hidden = !local;
        fields.url.parentElement.hidden = local;
        fields.token.parentElement.hidden = local;
    };

    transport.addEventListener("change", applyTransport);

    applyTransport();

    function parseEnvInput(raw) {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;
        // Try JSON first
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            // fall through to KEY=VALUE parser
        }
        // Parse KEY=VALUE lines
        const env = {};
        const lines = trimmed.split(/\n/);
        for (const line of lines) {
            const l = line.trim();
            if (!l || l.startsWith("#")) continue;
            const eq = l.indexOf("=");
            if (eq === -1) continue;
            const k = l.slice(0, eq).trim();
            const v = l.slice(eq + 1).trim();
            if (k) env[k] = v;
        }
        return Object.keys(env).length ? env : undefined;
    }

    form.appendChild(
        Modal.row(
            Modal.button("Connect", "", async () => {

                message.textContent = "connecting…";

                const body = {
                    name: fields.name.value.trim(),
                    transport: transport.value,
                    command: fields.command.value.trim() || undefined,
                    args:
                        fields.command_args.value.trim()
                            ? fields.command_args.value.trim().split(/\s+/)
                            : undefined,
                    command_args:
                        fields.command_args.value.trim()
                            ? fields.command_args.value.trim().split(/\s+/)
                            : undefined,
                    url: fields.url.value.trim() || undefined,
                    token: fields.token.value.trim() || undefined,
                    env: parseEnvInput(fields.env.value)
                };

                const response =
                    await fetch("/api/mcp", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body)
                    });

                const payload =
                    await response.json();

                if (!response.ok) {

                    message.textContent = payload.error;

                    return;
                }

                message.textContent = "";

                for (const input of Object.values(fields)) {
                    input.value = "";
                }

                refresh();
            })
        )
    );

    return form;
}

export function mcpBody(payload, refresh) {

    const container = node("div", "mcp");

    if (!payload.enabled) {

        container.appendChild(
            node(
                "p",
                "empty",
                "MCP is switched off. Turn MCP_ENABLED on in Settings to reach external servers."
            )
        );

        return container;
    }

    if (payload.servers.length === 0) {

        container.appendChild(
            node(
                "p",
                "empty",
                "No MCP servers are configured. Add one below, or declare it in .mcp.json in the workspace."
            )
        );
    }

    for (const server of payload.servers) {

        container.appendChild(mcpServerRow(server, refresh));
    }

    for (const problem of payload.problems || []) {

        container.appendChild(node("div", "mcp-error", problem));
    }

    if (payload.tools && payload.tools.length > 0) {

        const list = node("div", "mcp-tools");

        list.appendChild(
            node("h3", null, `${payload.tools.length} tool${payload.tools.length === 1 ? "" : "s"} available`)
        );

        for (const tool of payload.tools) {

            const item = node("div", "mcp-tool");

            item.append(
                node("span", "name", tool.name),
                node("span", "facts", tool.description || "")
            );

            list.appendChild(item);
        }

        container.appendChild(list);
    }

    container.appendChild(mcpAddForm(refresh));

    return container;
}

export async function openMcp() {

    if (mcpState.mcpModal && mcpState.mcpModal.isOpen()) {
        return mcpState.mcpModal;
    }

    if (mcpState.mcpOpening) {
        return null;
    }

    mcpState.mcpOpening = true;

    const load = async (refresh) => {

        const response =
            await fetch(`/api/mcp${refresh ? "?refresh=1" : ""}`);

        return response.json();
    };

    let payload;

    try {
        payload = await load(false);
    } catch {
        mcpState.mcpOpening = false;
        return null;
    }

    const refresh = async (force) => {

        let next;

        try {
            next = await load(force);
        } catch {
            return null;
        }

        if (mcpState.mcpModal && mcpState.mcpModal.isOpen()) {

            mcpState.mcpModal.setBody(mcpBody(next, () => refresh(false)));
        }
    };

    const handle =
        Modal.open({
            title: "MCP servers",

            subtitle:
                `${payload.tool_count} tool(s) from ${
                    payload.servers.filter(server => server.state === "ready").length
                } connected server(s)`,

            size: "medium",

            body: mcpBody(payload, () => refresh(false)),

            footer:
                Modal.row(
                    Modal.button("Reconnect all", "ghost", () => refresh(true)),
                    Modal.button("Close", "", () => handle.close("footer"))
                ),

            onClose: () => {

                mcpState.mcpModal = null;
            }
        });

    mcpState.mcpModal = handle;
    mcpState.mcpOpening = false;

    return handle;
}
