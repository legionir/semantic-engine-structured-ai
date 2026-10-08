"use strict";

/*
|--------------------------------------------------------------------------
| Semantic Engine — Open / Configure Project wizard
|--------------------------------------------------------------------------
| باز کردن پروژه، انتخاب مسیر، نحوهٔ اسکن، مدل embedding، اتصال provider،
| دریافت خودکار مدل‌ها، انتخاب مدل، مدل پیش‌فرض و شروع ایندکس‌سازی با
| نمایش زندهٔ پیشرفت (SSE).
*/

const $ = id => document.getElementById(id);

const state = {
  token: "",
  path: "",
  projectId: null,
  projectStatus: null,
  providers: [],
  localModels: [],
  jobId: null,
  sse: null,
};

// ── token handling ──────────────────────────────────────────────────────
function loadToken() {
  const q = new URLSearchParams(location.search);
  const fromQuery = q.get("token");
  const stored = localStorage.getItem("se.token") || "";
  state.token = fromQuery || stored || "";
  $("tokenInput").value = state.token;
  if (fromQuery) localStorage.setItem("se.token", fromQuery);
}

function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (state.token) h["Authorization"] = "Bearer " + state.token;
  return h;
}

async function api(method, path, body) {
  const opts = { method, headers: authHeaders(body ? { "Content-Type": "application/json" } : {}) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || (res.status + " " + res.statusText);
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// ── status / health ─────────────────────────────────────────────────────
async function checkHealth() {
  try {
    await api("GET", "/health");
    setStatus("done", "connected");
  } catch (e) {
    setStatus("failed", "connection failed");
  }
}
function setStatus(cls, text) {
  const dot = $("statusDot");
  dot.className = "dot " + cls;
  $("statusText").textContent = text;
}

// ── file browser ────────────────────────────────────────────────────────
async function browse(path) {
  const url = "/api/v1/fs/browse" + (path ? "?path=" + encodeURIComponent(path) : "");
  const data = await api("GET", url);
  $("browser").hidden = false;
  $("browserPath").textContent = data.path;
  $("browser").dataset.current = data.path;
  $("browser").dataset.parent = data.parent || "";
  const list = $("browserList");
  list.innerHTML = "";
  for (const entry of data.entries) {
    const li = document.createElement("li");
    if (!entry.isDirectory) li.className = "file";
    const icon = document.createElement("span");
    icon.className = "entry-icon";
    icon.textContent = entry.isDirectory ? "📁" : "📄";
    const name = document.createElement("span");
    name.textContent = entry.name;
    li.appendChild(icon);
    li.appendChild(name);
    if (entry.hint) {
      const hint = document.createElement("span");
      hint.className = "entry-hint " + entry.hint;
      hint.textContent = entry.hint === "indexed" ? "indexed" : "project";
      li.appendChild(hint);
    }
    if (entry.isDirectory) {
      li.addEventListener("click", () => browse(entry.path));
    }
    list.appendChild(li);
  }
}

// ── provider / models ───────────────────────────────────────────────────
async function loadProviders() {
  try {
    const data = await api("GET", "/api/v1/providers");
    state.providers = data.providers || [];
    state.localModels = data.localModels || [];
    const sel = $("providerSelect");
    sel.innerHTML = "";
    for (const p of state.providers) {
      const opt = document.createElement("option");
      opt.value = p.kind;
      opt.textContent = p.label;
      sel.appendChild(opt);
    }
    applyProvider();
  } catch (e) {
    log("bad", "Could not load providers: " + e.message);
  }
}

function currentProvider() {
  const kind = $("providerSelect").value;
  return state.providers.find(p => p.kind === kind) || null;
}

function applyProvider() {
  const p = currentProvider();
  if (!p) return;
  $("baseUrlField").hidden = !p.needsBaseUrl;
  $("apiKeyField").hidden = !p.acceptsApiKey;
  if (p.defaultBaseUrl && !$("baseUrlInput").value) $("baseUrlInput").value = p.defaultBaseUrl;
  $("providerHint").textContent = p.description + " · default model: " + p.defaultModel;

  if (p.kind === "local") {
    // مدل‌های لوکال بدون درخواست شبکه آماده‌اند.
    fillModels(state.localModels, p.defaultModel);
    $("fetchStatus").textContent = state.localModels.length + " local models available";
  } else {
    $("modelSelect").innerHTML = '<option value="">— connect to load models —</option>';
    $("fetchStatus").textContent = "";
  }
}

function fillModels(models, defaultModel) {
  const sel = $("modelSelect");
  sel.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name + (m.dimensions ? " (" + m.dimensions + "d)" : "") + (m.description ? " — " + m.description : "");
    if (m.id === defaultModel || m.isDefault) opt.dataset.default = "1";
    sel.appendChild(opt);
  }
  // انتخاب مدل پیش‌فرض
  const def = models.find(m => m.id === defaultModel) || models.find(m => m.isDefault) || models[0];
  if (def) sel.value = def.id;
  syncDefaultModelToggle();
}

async function fetchModels() {
  const p = currentProvider();
  if (!p) return;
  const btn = $("fetchModelsBtn");
  btn.disabled = true;
  $("fetchStatus").textContent = "Connecting…";
  try {
    const body = { provider: p.kind };
    if (p.needsBaseUrl) body.baseUrl = $("baseUrlInput").value.trim();
    if (p.acceptsApiKey && $("apiKeyInput").value) body.apiKey = $("apiKeyInput").value;
    const result = await api("POST", "/api/v1/providers/models", body);
    if (!result.connected) throw new Error(result.error || "connection failed");
    fillModels(result.models, result.defaultModel);
    $("fetchStatus").textContent = result.models.length + " models loaded (default: " + result.defaultModel + ")";
  } catch (e) {
    $("fetchStatus").textContent = "✗ " + e.message;
  } finally {
    btn.disabled = false;
  }
}

function syncDefaultModelToggle() {
  const useDefault = $("useDefaultModel").checked;
  $("modelSelect").disabled = useDefault;
}

// ── project selection ───────────────────────────────────────────────────
/*
| SE-UI-001 — a project switch must leave NO trace of the previous project.
| Previously a failed POST /projects kept state.projectId, the badge and the
| visualizer link pointing at the OLD project — so "Start indexing" would
| index the project the user believed they had left, and the dashboard link
| opened the wrong project. A successfully-opened but not-yet-indexed project
| also kept the old visualizer href. Now the selection is reset to a coherent
| "no project" state on failure, and the visualizer link is hidden whenever
| the current project is not ready.
*/
function clearProjectSelection() {
  state.projectId = null;
  state.projectStatus = null;
  state.jobId = null;
  const badge = $("projStatusBadge");
  badge.textContent = "no project";
  badge.className = "badge missing";
  $("selectedProject").hidden = true;
  $("startIndexBtn").disabled = true;
  $("gotoVisualizerBtn").hidden = true;
  $("gotoVisualizerBtn").removeAttribute("href");
}

async function selectProject(path) {
  state.path = path;
  $("pathInput").value = path;
  // the previous selection is invalid the moment a new switch starts
  clearProjectSelection();
  try {
    const project = await api("POST", "/api/v1/projects", { path });
    state.projectId = project.id;
    state.projectStatus = project.status;
    $("selectedProject").hidden = false;
    $("selectedPathCode").textContent = project.rootPath;
    const badge = $("projStatusBadge");
    badge.textContent = project.status === "ready" ? "indexed" : "not indexed";
    badge.className = "badge " + (project.status === "ready" ? "ready" : "missing");
    $("startIndexBtn").disabled = false;
    if (project.status === "ready") {
      $("gotoVisualizerBtn").hidden = false;
      $("gotoVisualizerBtn").href = "/visualizer.html?project=" + encodeURIComponent(project.id);
    }
    log("ok", "Project opened: " + project.rootPath + " (" + project.status + ")");
  } catch (e) {
    clearProjectSelection();
    log("bad", "Could not open project: " + e.message + " — no project is selected");
  }
}

// ── indexing ────────────────────────────────────────────────────────────
function collectIndexOptions() {
  const extra = $("extraIgnore").value.split(",").map(s => s.trim()).filter(Boolean);
  const embeddingEnabled = $("embeddingEnabled").checked;
  const p = currentProvider();
  const body = {
    scan: {
      treeSitter: $("scanEngine").value === "tree-sitter",
      useGitignore: $("useGitignore").checked,
      skipHiddenDirectories: $("skipHidden").checked,
      maxDepth: parseInt($("maxDepth").value, 10) || 0,
      maxFileSizeMb: parseFloat($("maxFileSize").value) || 5,
      additionalIgnorePatterns: extra,
    },
    output: {
      blueprint: $("wantBlueprint").checked,
    },
    lsp: { diagnostics: $("wantLspDiagnostics")?.checked === true },
    embedding: { enabled: false },
  };
  if (embeddingEnabled && p) {
    const useDefault = $("useDefaultModel").checked;
    body.embedding = {
      enabled: true,
      provider: p.kind,
      useDefaultModel: useDefault,
      model: useDefault ? "" : $("modelSelect").value,
      normalize: $("normalizeVectors").checked,
    };
    if (p.needsBaseUrl) body.embedding.baseUrl = $("baseUrlInput").value.trim();
    if (p.acceptsApiKey && $("apiKeyInput").value) body.embedding.apiKey = $("apiKeyInput").value;
  }
  return body;
}

async function startIndex() {
  if (!state.projectId) return;
  const body = collectIndexOptions();
  $("startIndexBtn").disabled = true;
  $("progressWrap").hidden = false;
  setProgress("Queued…", 0);
  openEvents(state.projectId);
  try {
    const res = await api("POST", "/api/v1/projects/" + state.projectId + "/index", body);
    state.jobId = res.jobId;
    $("cancelIndexBtn").hidden = false;
    log("info", "Indexing started (job " + res.jobId + ")");
    if (res.options && res.options.embedding) {
      log("info", "embedding: " + res.options.embedding.provider + " · model " + (res.options.embedding.model || "default"));
    }
    pollJob();
  } catch (e) {
    log("bad", "Could not start indexing: " + e.message);
    $("startIndexBtn").disabled = false;
  }
}

async function pollJob() {
  if (!state.jobId) return;
  try {
    const job = await api("GET", "/api/v1/projects/" + state.projectId + "/jobs/" + state.jobId);
    setProgress(phaseLabel(job.phase), job.progress);
    if (job.status === "completed") {
      onJobDone(job);
      return;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      log("bad", "job " + job.status + (job.error ? ": " + job.error : ""));
      $("startIndexBtn").disabled = false;
      $("cancelIndexBtn").hidden = true;
      setStatus("failed", "indexing failed");
      return;
    }
    setTimeout(pollJob, 900);
  } catch (e) {
    log("bad", "Could not read job status: " + e.message);
    setTimeout(pollJob, 1500);
  }
}

function onJobDone(job) {
  setProgress("Done", 100);
  $("cancelIndexBtn").hidden = true;
  const r = job.result || {};
  log("ok", "Indexing complete — files: " + (r.files ?? "?") + " · symbols: " + (r.symbols ?? "?") +
    (r.vectorChunks ? " · chunks: " + r.vectorChunks : "") +
    (r.embeddingModel ? " · model: " + r.embeddingModel : ""));
  $("gotoVisualizerBtn").hidden = false;
  $("gotoVisualizerBtn").href = "/visualizer.html?project=" + encodeURIComponent(state.projectId);
  $("startIndexBtn").disabled = false;
  const badge = $("projStatusBadge");
  badge.textContent = "indexed"; badge.className = "badge ready";
}

async function cancelIndex() {
  if (!state.jobId) return;
  try {
    await api("POST", "/api/v1/projects/" + state.projectId + "/jobs/" + state.jobId + "/cancel");
    log("info", "Cancellation requested");
  } catch (e) {
    log("bad", "Could not cancel: " + e.message);
  }
}

// SSE stream (real-time progress; poll is the fallback)
function openEvents(projectId) {
  if (state.sse) { state.sse.close(); state.sse = null; }
  try {
    const url = "/api/v1/projects/" + projectId + "/events" + (state.token ? "?token=" + encodeURIComponent(state.token) : "");
    const es = new EventSource(url);
    es.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type && msg.type.startsWith("job.") && msg.data) {
          setProgress(phaseLabel(msg.data.phase), msg.data.progress || 0);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* poll covers us */ };
    state.sse = es;
  } catch { /* EventSource unsupported → poll only */ }
}

// ── ui helpers ──────────────────────────────────────────────────────────
function phaseLabel(phase) {
  const map = {
    init: "starting", scanning: "scanning files", parsing: "parsing",
    symbols: "extracting symbols", graphs: "building graphs",
    finalizing: "finalizing", done: "done",
  };
  return map[phase] || phase || "…";
}
function setProgress(phase, pct) {
  $("progressPhase").textContent = phase;
  $("progressPct").textContent = Math.round(pct) + "%";
  $("progressFill").style.width = Math.round(pct) + "%";
  setStatus(pct >= 100 ? "done" : "running", phase);
}
function log(cls, text) {
  const el = $("jobLog");
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = new Date().toLocaleTimeString() + "  " + text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ── events wiring ───────────────────────────────────────────────────────
function bind() {
  $("saveTokenBtn").addEventListener("click", () => {
    state.token = $("tokenInput").value.trim();
    localStorage.setItem("se.token", state.token);
    checkHealth();
    loadProviders();
    log("info", "Token saved");
  });
  $("tokenInput").addEventListener("input", () => { state.token = $("tokenInput").value.trim(); });

  $("browseBtn").addEventListener("click", () => browse($("pathInput").value.trim() || ""));
  $("closeBrowserBtn").addEventListener("click", () => { $("browser").hidden = true; });
  $("upBtn").addEventListener("click", () => {
    const parent = $("browser").dataset.parent;
    if (parent) browse(parent);
  });
  $("selectDirBtn").addEventListener("click", () => {
    const current = $("browser").dataset.current;
    if (current) { selectProject(current); $("browser").hidden = true; }
  });
  $("useCwdBtn").addEventListener("click", async () => {
    try {
      const data = await api("GET", "/api/v1/fs/browse");
      selectProject(data.cwd || data.path);
    } catch (e) { log("bad", e.message); }
  });
  $("pathInput").addEventListener("keydown", e => {
    if (e.key === "Enter") selectProject($("pathInput").value.trim());
  });

  $("providerSelect").addEventListener("change", applyProvider);
  $("fetchModelsBtn").addEventListener("click", fetchModels);
  $("useDefaultModel").addEventListener("change", syncDefaultModelToggle);
  $("embeddingEnabled").addEventListener("change", () => {
    $("embeddingConfig").hidden = !$("embeddingEnabled").checked;
  });

  $("startIndexBtn").addEventListener("click", startIndex);
  $("cancelIndexBtn").addEventListener("click", cancelIndex);

  // LLM (chat) config
  $("llmFetchBtn").addEventListener("click", fetchLlmModels);
  $("llmSaveBtn").addEventListener("click", saveLlm);
}

// ── LLM (chat) settings ─────────────────────────────────────────────────
async function loadLlmConfig() {
  try {
    const cfg = await api("GET", "/api/v1/chat/llm");
    if (cfg.configured) {
      $("llmBaseUrl").value = cfg.baseUrl || "";
      if (cfg.model) $("llmModelSelect").value = cfg.model;
      if (typeof cfg.temperature === "number") $("llmTemp").value = cfg.temperature;
      $("llmSaveStatus").textContent = "Current model: " + cfg.model;
    }
  } catch { /* ignore */ }
}

async function fetchLlmModels() {
  const btn = $("llmFetchBtn");
  btn.disabled = true;
  $("llmFetchStatus").textContent = "Connecting…";
  try {
    const body = { baseUrl: $("llmBaseUrl").value.trim() };
    if ($("llmApiKey").value) body.apiKey = $("llmApiKey").value;
    const result = await api("POST", "/api/v1/chat/llm/test", body);
    if (!result.connected) throw new Error(result.error || "connection failed");
    const list = $("llmModelList");
    list.innerHTML = "";
    for (const m of result.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      list.appendChild(opt);
    }
    // فقط اگر کاربر خودش چیزی تایپ نکرده، مدل پیش‌فرض را بگذار
    if (!$("llmModelSelect").value && result.defaultModel) {
      $("llmModelSelect").value = result.defaultModel;
    }
    $("llmFetchStatus").textContent = result.models.length + " models loaded";
  } catch (e) {
    // دریافت خودکار اختیاری است — راهنمایی کن که مدل را دستی وارد کند
    $("llmFetchStatus").textContent = "Could not load models (" + e.message + ") — type the model name manually and save.";
  } finally {
    btn.disabled = false;
  }
}

async function saveLlm() {
  const baseUrl = $("llmBaseUrl").value.trim();
  const model = $("llmModelSelect").value.trim();
  if (!baseUrl || !model) {
    $("llmSaveStatus").textContent = "Base URL and model name are required";
    return;
  }
  try {
    const body = { baseUrl, model, temperature: parseFloat($("llmTemp").value) || 0.2 };
    if ($("llmApiKey").value) body.apiKey = $("llmApiKey").value;
    const cfg = await api("PUT", "/api/v1/chat/llm", body);
    $("llmSaveStatus").textContent = "Saved — model: " + cfg.model;
  } catch (e) {
    $("llmSaveStatus").textContent = "✗ " + e.message;
  }
}

function init() {
  loadToken();
  bind();
  checkHealth();
  loadProviders();
  loadLlmConfig();
  // اگر با #llm آمده‌ایم، به بخش LLM اسکرول کن
  if (location.hash === "#llm") {
    setTimeout(() => $("cardLlm")?.scrollIntoView({ behavior: "smooth" }), 300);
  }
}

init();
