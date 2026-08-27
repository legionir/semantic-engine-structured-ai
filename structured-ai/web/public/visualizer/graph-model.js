/*
|--------------------------------------------------------------------------
| Visualizer graph-model (EXECUTION_PLAN Phase 25 گام ۱)
|--------------------------------------------------------------------------
| What the views are, and what the demo data is.
|
| `generateFallbackData` is the sample dataset shown when the server cannot answer, with a variant per view; `updateBreadcrumb` maps a view onto its Level-of-Detail step; `drillDown` decides what a double-click means for a node type. Nothing here touches the DOM beyond the breadcrumb and the title, which is what lets the renderer and the model be read separately.
|--------------------------------------------------------------------------
*/

import { projectTitleEl } from "./page.js";
import { setGraphData } from "./graph-store.js";
import { loadNeighborhood, loadView } from "./api-client.js";

export function updateBreadcrumb(viewType) {
  document.querySelectorAll(".lod-step").forEach(s => s.classList.remove("active"));
  if (viewType === "architecture") document.getElementById("lodStep1").classList.add("active");
  else if (viewType === "module") document.getElementById("lodStep2").classList.add("active");
  else if (viewType === "dependencies") document.getElementById("lodStep3").classList.add("active");
  else document.getElementById("lodStep4").classList.add("active");
}

export function drillDown(node) {
  if (node.type === "module") {
    loadView("module");
  } else if (node.type === "file") {
    loadView("dependencies");
  } else {
    loadNeighborhood(node.id);
  }
}

export function generateFallbackData(viewType) {
  let sampleNodes = [
    { id: "mod-auth", type: "module", label: "Auth Module", metadata: { path: "src/auth" } },
    { id: "mod-users", type: "module", label: "Users Module", metadata: { path: "src/users" } },
    { id: "api-login", type: "api", label: "POST /auth/login", metadata: { path: "src/auth/login.ts" } },
    { id: "class-auth-service", type: "class", label: "AuthService", metadata: { path: "src/auth/auth.service.ts", line: 10, endLine: 45, complexity: 4, referencesCount: 12 } },
    { id: "fn-login", type: "function", label: "login()", metadata: { path: "src/auth/auth.service.ts", line: 15, endLine: 35, complexity: 3, referencesCount: 8 } },
    { id: "class-user-repo", type: "class", label: "UserRepository", metadata: { path: "src/users/user.repo.ts", line: 5, endLine: 50, complexity: 2, referencesCount: 18 } },
    { id: "wf-login-flow", type: "workflow", label: "User Login Workflow", metadata: {} },
  ];

  let sampleEdges = [
    { id: "e1", source: "api-login", target: "fn-login", relation: "calls", metadata: { confidence: 95 } },
    { id: "e2", source: "class-auth-service", target: "fn-login", relation: "contains", metadata: { confidence: 100 } },
    { id: "e3", source: "fn-login", target: "class-user-repo", relation: "calls", metadata: { confidence: 90 } },
    { id: "e4", source: "mod-auth", target: "mod-users", relation: "depends_on", metadata: { confidence: 85 } },
    { id: "e5", source: "wf-login-flow", target: "api-login", relation: "executes", metadata: { confidence: 100 } },
  ];

  if (viewType === "business-mapping") {
    sampleNodes = [
      { id: "biz-auth", type: "workflow", label: "Customer Identity", metadata: { role: "business-entity" } },
      { id: "biz-orders", type: "workflow", label: "Order Checkout", metadata: { role: "business-entity" } },
      { id: "api-login", type: "api", label: "POST /auth/login", metadata: { path: "src/auth/login.ts" } },
      { id: "api-checkout", type: "api", label: "POST /orders/checkout", metadata: { path: "src/orders/checkout.ts" } },
      { id: "class-auth-service", type: "class", label: "AuthService", metadata: { path: "src/auth/auth.service.ts" } },
    ];
    sampleEdges = [
      { id: "be1", source: "biz-auth", target: "api-login", relation: "implements", metadata: { confidence: 95 } },
      { id: "be2", source: "biz-orders", target: "api-checkout", relation: "implements", metadata: { confidence: 95 } },
      { id: "be3", source: "api-login", target: "class-auth-service", relation: "calls", metadata: { confidence: 90 } },
    ];
  } else if (viewType === "test-intelligence") {
    sampleNodes = [
      { id: "test-auth", type: "file", label: "auth.service.test.ts", metadata: { role: "test-suite" } },
      { id: "class-auth-service", type: "class", label: "AuthService", metadata: { path: "src/auth/auth.service.ts" } },
      { id: "test-users", type: "file", label: "user.repo.test.ts", metadata: { role: "test-suite" } },
      { id: "class-user-repo", type: "class", label: "UserRepository", metadata: { path: "src/users/user.repo.ts" } },
      { id: "fn-untested", type: "function", label: "legacyMigrate() [Untested]", metadata: { complexity: 8, referencesCount: 2 } },
    ];
    sampleEdges = [
      { id: "te1", source: "test-auth", target: "class-auth-service", relation: "references", metadata: { confidence: 100 } },
      { id: "te2", source: "test-users", target: "class-user-repo", relation: "references", metadata: { confidence: 100 } },
    ];
  } else if (viewType === "hotspots") {
    sampleNodes = [
      { id: "hot-1", type: "file", label: "auth.service.ts (Hotspot: 92/100)", metadata: { complexity: 6, churn: 45 } },
      { id: "hot-2", type: "file", label: "payment.gateway.ts (Hotspot: 88/100)", metadata: { complexity: 8, churn: 32 } },
      { id: "hot-3", type: "file", label: "user.controller.ts (Hotspot: 64/100)", metadata: { complexity: 4, churn: 28 } },
    ];
    sampleEdges = [
      { id: "he1", source: "hot-1", target: "hot-2", relation: "depends_on", metadata: { confidence: 85 } },
    ];
  }

  setGraphData(sampleNodes, sampleEdges);
  projectTitleEl.textContent = `Workspace Intelligence (${viewType})`;
}
