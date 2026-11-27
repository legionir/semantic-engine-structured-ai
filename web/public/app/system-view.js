/*
|--------------------------------------------------------------------------
| System resources (roadmap P1-07)
|--------------------------------------------------------------------------
|
| The System modal: CPU, memory and every disk the console writes to, the
| runs in flight and waiting for a slot, the background processes the
| agent started (each can be stopped) and the low-memory / low-disk
| warnings. It refreshes every few seconds while open. The header's System
| button turns amber when the server reports a warning (the
| system:resources event, or the last refresh).
*/

import { state, touch } from "./store.js";
import { html, mountInModal } from "./dom.js";
import { el } from "./console-core.js";
import { apiRequest, formatBytes } from "./operator-api.js";
import { SkeletonCards, SkeletonRows } from "./skeleton-view.js";


let timer = null;


function system() {

    if (!state.system) state.system = { data: null, error: null, stopping: new Set() };

    return state.system;
}


function meter(label, value, detail, percent, warning) {

    return html`
        <div class=${`system-meter${warning ? " warning" : ""}`}>
            <span class="label">${label}</span>
            <span class="value">${value}</span>
            ${Number.isFinite(percent) ? html`<progress max="100" value=${Math.max(0, Math.min(100, percent))}></progress>` : null}
            <span class="muted">${detail}</span>
        </div>
    `;
}


function duration(ms) {

    const minutes = Math.floor(ms / 60000);

    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);

    return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} days`;
}


export function SystemBody({ view, actions }) {

    if (view.error && !view.data) return html`<p class="mcp-error">${view.error}</p>`;

    if (!view.data) {
        return html`<div class="system-view">
            <${SkeletonCards} count=${4} label="Loading…" />
            <${SkeletonRows} count=${3} compact=${true} label="Loading processes…" />
        </div>`;
    }

    const data = view.data;
    const memoryWarning = data.warnings.some(item => item.kind === "memory");
    const runs = data.runs;

    return html`
        <div class="system-view">
            ${data.warnings.length > 0 ? html`
                <div class="system-warnings" role="alert">
                    ${data.warnings.map(item => html`<span key=${item.message}>⚠ ${item.message}</span>`)}
                </div>
            ` : null}
            <div class="system-meters">
                ${meter(
                    "CPU",
                    Number.isFinite(data.cpu.percent) ? `${data.cpu.percent}%` : `${data.cpu.load[0]}`,
                    `${data.cpu.cores} core(s) · load ${data.cpu.load.join(" / ")}`,
                    data.cpu.percent,
                    false
                )}
                ${meter(
                    "Memory",
                    `${formatBytes(data.memory.available_bytes)} free`,
                    `of ${formatBytes(data.memory.total_bytes)} · console ${formatBytes(data.memory.process_rss_bytes)}`,
                    data.memory.used_percent,
                    memoryWarning
                )}
                ${data.disks.map(disk => disk.error
                    ? meter(`Disk · ${disk.label}`, "?", disk.error, NaN, false)
                    : meter(
                        `Disk · ${disk.label}`,
                        `${formatBytes(disk.free_bytes)} free`,
                        `of ${formatBytes(disk.total_bytes)} · ${disk.path}`,
                        disk.total_bytes > 0 ? 100 - (disk.free_bytes / disk.total_bytes) * 100 : NaN,
                        data.warnings.some(item => item.kind === "disk" && item.path === disk.path)
                    ))}
                ${runs ? meter(
                    "Runs",
                    `${runs.active} running`,
                    `${runs.queued} waiting · ${runs.active_projects}/${runs.max_concurrent_projects} projects · ${runs.max_runs_per_project} per project`,
                    runs.max_concurrent_projects > 0 ? (runs.active_projects / runs.max_concurrent_projects) * 100 : NaN,
                    runs.queued > 0
                ) : null}
            </div>
            <section>
                <h3 class="system-section-title">Background processes (${data.processes.length})</h3>
                ${data.processes.length === 0
                    ? html`<p class="empty">No background process is running.</p>`
                    : html`
                        <div class="table-scroll">
                            <table class="system-processes">
                                <thead><tr><th>process</th><th>command</th><th>project</th><th>running for</th><th></th></tr></thead>
                                <tbody>
                                    ${data.processes.map(item => html`
                                        <tr key=${item.id}>
                                            <td>${item.id}<br /><span class="muted">pid ${item.pid}</span></td>
                                            <td class="command">${item.command}</td>
                                            <td>${item.project_id || "workspace"}${item.run_id && !item.run_active ? html`<br /><span class="muted">its run ended</span>` : null}</td>
                                            <td>${item.started_at ? duration(Date.now() - Date.parse(item.started_at)) : ""}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    class="ghost danger"
                                                    disabled=${view.stopping.has(item.id)}
                                                    onClick=${() => actions.stop(item.id)}
                                                >${view.stopping.has(item.id) ? "Stopping…" : "Stop"}</button>
                                            </td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table>
                        </div>
                    `}
            </section>
            <p class="muted">${data.platform} · Node.js ${data.node} · up ${duration(data.uptime_ms)}${view.error ? ` · ${view.error}` : ""}</p>
        </div>
    `;
}


export function markSystemWarnings(warnings) {

    const button = el("systemButton");

    if (!button) return;

    const list = Array.isArray(warnings) ? warnings : [];

    button.classList.toggle("alert", list.length > 0);
    button.title = list.length > 0
        ? list.map(item => item.message).join("\n")
        : "CPU, memory, disk, runs and background processes";
}


async function refresh() {

    const view = system();
    const result = await apiRequest("/api/system");

    if (result.ok) {
        view.data = result.payload;
        view.error = null;
        markSystemWarnings(result.payload.warnings);
    } else {
        view.error = result.error;
    }

    touch("system");
}


/*
| The header button's colour without opening the modal: on page load and
| whenever the server reports a warning change. Only the admin token can
| read /api/system; for any other the button is hidden.
*/
export async function refreshSystemWarnings() {

    const result = await apiRequest("/api/system");
    const button = el("systemButton");

    if (result.ok) {
        markSystemWarnings(result.payload.warnings);
        if (state.system) state.system.data = result.payload;
        touch("system");
    } else if ((result.status === 401 || result.status === 403) && button) {
        button.hidden = true;
    }
}


const actions = {

    async stop(id) {

        const view = system();

        view.stopping.add(id);
        touch("system");

        const result = await apiRequest(`/api/system/processes/${encodeURIComponent(id)}/stop`, { method: "POST" });

        if (!result.ok) view.error = result.error;

        setTimeout(() => {
            view.stopping.delete(id);
            void refresh();
        }, 600);
    }
};


export function openSystem() {

    let dispose = () => {};

    const handle = Modal.open({
        title: "System",
        subtitle: "Resources of this server",
        size: "large",
        onClose: () => {
            clearInterval(timer);
            timer = null;
            dispose();
        }
    });

    dispose = mountInModal(handle, () => SystemBody({ view: system(), actions }), ["system"]);

    void refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 4000);

    return handle;
}
