/* Relative Web API client — EXECUTION_PLAN Phase 24. */

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}


async function decode(response) {
  const type = response.headers?.get?.("content-type") || "";
  if (type.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => "");
}


export async function request(url, options = {}) {
  const headers = {
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.headers || {})
  };
  const response = await fetch(url, { ...options, headers });
  const payload = await decode(response);

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `request failed (${response.status})`,
      response.status,
      payload
    );
  }

  return payload;
}


export const getState = () => request("/api/state");
export const getProjects = () => request("/api/projects");
export const getSettings = () => request("/api/settings");
export const getMcp = refresh =>
  request(refresh ? "/api/mcp?refresh=1" : "/api/mcp");
export const getSessions = () => request("/api/sessions");
export const getHealth = () => request("/api/health");
export const getProject = id => request(`/api/projects/${encodeURIComponent(id)}`);
export const getProjectState = id =>
  request(`/api/projects/${encodeURIComponent(id)}/state`);
export const getProjectSessions = id =>
  request(`/api/projects/${encodeURIComponent(id)}/sessions`);
export const getProjectMetrics = id =>
  request(`/api/projects/${encodeURIComponent(id)}/metrics`);
export const getProjectHealth = id =>
  request(`/api/projects/${encodeURIComponent(id)}/health`);

export const getProjectDiscussions = id =>
  request(`/api/projects/${encodeURIComponent(id)}/discussions`);

export const getProjectDiscussion = (projectId, discussionId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/discussions/${encodeURIComponent(discussionId)}`);

export const postDiscussion = (task, personas, maxRounds, projectId = null) =>
  request(
    projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/discussions`
      : "/api/discussion",
    {
      method: "POST",
      body: JSON.stringify({ task, personas, max_rounds: maxRounds })
    }
  );


export const postTask = (task, projectId) =>
  request(
    projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/tasks`
      : "/api/tasks",
    { method: "POST", body: JSON.stringify({ task }) }
  );

export const postChat = (task, projectId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/chat`, {
    method: "POST",
    body: JSON.stringify({ task })
  });

export const cancel = projectId =>
  request(
    projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/cancel`
      : "/api/cancel",
    { method: "POST" }
  );

export const clear = () => request("/api/clear", { method: "POST" });

export const setSetting = (key, value) =>
  request("/api/settings", {
    method: "POST",
    body: JSON.stringify({ key, value })
  });

export const setApprovalMode = mode =>
  request("/api/approval-mode", {
    method: "POST",
    body: JSON.stringify({ mode })
  });

export const answerApproval = (id, approved) =>
  request(`/api/approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ approved })
  });
