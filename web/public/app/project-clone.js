/*
|--------------------------------------------------------------------------
| New project from a git URL (roadmap P1-02)
|--------------------------------------------------------------------------
|
| The second mode of the New Project dialog: URL, branch, shallow, the
| folder under the projects root, a display name and, for a private
| repository, the name of the secret holding the token. The clone runs on
| the server; this polls its job and draws git's own progress until the
| project is registered, then opens it.
*/

import { html } from "./dom.js";
import { touch } from "./store.js";


export function suggestedFolder(url) {

    const last =
        String(url || "")
            .trim()
            .replace(/[?#].*$/, "")
            .replace(/\/+$/, "")
            .split(/[/:]/)
            .pop() || "";

    return last
        .replace(/\.git$/i, "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 100);
}


export function CloneForm({ form, refs, actions }) {

    const job = form.job;
    const running = job && job.status === "running";

    return html`
        <label class="mcp-field">
            <span class="label">repository URL</span>
            <input
                name="url"
                placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
                ref=${refs.url}
                disabled=${running}
                onInput=${event => actions.urlChanged(event.currentTarget.value)}
            />
        </label>
        <div class="clone-row">
            <label class="mcp-field">
                <span class="label">branch or tag (optional)</span>
                <input name="branch" placeholder="default branch" ref=${refs.branch} disabled=${running} />
            </label>
            <label class="mcp-field">
                <span class="label">folder in ${form.root || "the projects root"}</span>
                <input name="folder" placeholder=${form.suggested || "repository name"} ref=${refs.folder} disabled=${running} />
            </label>
        </div>
        <div class="clone-row">
            <label class="mcp-field">
                <span class="label">name (optional)</span>
                <input name="cloneName" placeholder="Display name" ref=${refs.cloneName} disabled=${running} />
            </label>
            <label class="mcp-field">
                <span class="label">token secret (private repositories)</span>
                <input
                    name="secret"
                    placeholder="GITHUB_PAT, GITLAB_TOKEN…"
                    list="cloneSecretNames"
                    ref=${refs.secret}
                    disabled=${running}
                />
                <datalist id="cloneSecretNames">
                    ${(form.secrets || []).map(name => html`<option key=${name} value=${name}></option>`)}
                </datalist>
            </label>
        </div>
        <label class="mcp-check">
            <input type="checkbox" name="shallow" ref=${refs.shallow} disabled=${running} />
            <span>shallow clone (latest commit only; faster, no history)</span>
        </label>
        <p class="mcp-hint">
            A token is taken from the secret named here, else GIT_CLONE_TOKEN, else GITHUB_PAT (github.com) or
            GITLAB_TOKEN (gitlab.com) from the secret store. It is sent to git as a header, never stored in the clone.
        </p>
        ${job ? html`
            <div class=${`clone-progress ${job.status}`}>
                <div class="clone-status">
                    <span>${job.status === "running" ? `${job.phase || "starting"}…` : job.status === "succeeded" ? "Cloned" : "Failed"}</span>
                    <span class="muted">${job.status === "running" ? `${job.percent || 0}%` : ""}</span>
                </div>
                ${job.status === "running" ? html`<progress max="100" value=${job.percent || 0}></progress>` : null}
                ${job.output && job.output.length > 0
                    ? html`<pre class="clone-output">${job.output.slice(-6).join("\n")}</pre>`
                    : null}
                ${job.error ? html`<p class="mcp-error">${job.error}</p>` : null}
            </div>
        ` : null}
        <p class="mcp-message">${form.message}</p>
    `;
}


/*
| Starts the clone and follows it. `done(project)` runs once the project
| is registered.
*/
export async function startClone(form, refs, done) {

    const say = message => {
        form.message = message;
        touch("projects");
    };

    const url = (refs.url.current?.value || "").trim();

    if (!url) {
        say("a repository URL is required");
        return;
    }

    const body = {
        url,
        branch: (refs.branch.current?.value || "").trim() || undefined,
        folder: (refs.folder.current?.value || "").trim() || undefined,
        name: (refs.cloneName.current?.value || "").trim() || undefined,
        secret: (refs.secret.current?.value || "").trim() || undefined,
        shallow: refs.shallow.current?.checked === true
    };

    form.busy = true;
    say("");

    let response;

    try {
        response = await fetch("/api/project-clones", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });
    } catch (error) {
        form.busy = false;
        say(`could not start the clone: ${error.message || "network error"}`);
        return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.job) {
        form.busy = false;
        say(payload.error || "could not start the clone");
        return;
    }

    form.job = payload.job;
    touch("projects");

    await followClone(form, done);
}


async function followClone(form, done) {

    while (form.job && form.job.status === "running" && !form.closed) {

        await new Promise(resolve => setTimeout(resolve, form.pollMs || 700));

        if (form.closed) {
            return;
        }

        try {

            const response = await fetch(`/api/project-clones/${encodeURIComponent(form.job.id)}`);
            const payload = await response.json().catch(() => ({}));

            if (response.ok && payload.job) {
                form.job = payload.job;
                touch("projects");
            }

        } catch {
            /* a missed poll is retried */
        }
    }

    form.busy = false;
    touch("projects");

    if (form.job && form.job.status === "succeeded" && form.job.project && !form.closed) {
        await done(form.job.project);
    }
}


/* the projects root and the secret names, for the form's hints */
export async function loadCloneContext(form) {

    try {

        const response = await fetch("/api/project-clones");

        if (response.ok) {
            const payload = await response.json();
            form.root = payload.root || null;
        }

    } catch {
        /* the hint just stays generic */
    }

    try {

        const response = await fetch("/api/secrets");

        if (response.ok) {
            const payload = await response.json();
            form.secrets = (payload.secrets || []).map(secret => secret.name);
        }

    } catch {
        /* only admin tokens can list secrets */
    }

    touch("projects");
}
