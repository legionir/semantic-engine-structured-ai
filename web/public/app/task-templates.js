/*
|--------------------------------------------------------------------------
| Task templates service
|--------------------------------------------------------------------------
|
| Reusable task description store backed by browser storage (or an injected
| storage adapter in tests). Allows saving, updating, searching, loading,
| and deleting common task templates without touching the DOM.
*/

export const TASK_TEMPLATES_KEY = "structured-ai.taskTemplates";

const VALID_MODES = new Set(["auto", "prompt", "deny", "plan"]);
const VALID_EFFORTS = new Set(["inherit", "low", "medium", "high", "xhigh"]);


function defaultStorage() {

    try {
        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch {
        /* private browsing or disabled storage */
    }

    return null;
}


function slugify(name) {

    const base = String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);

    return base || "template";
}


function makeId(name) {

    const suffix = Math.random().toString(36).slice(2, 8);
    return `tpl-${slugify(name)}-${suffix}`;
}


function cloneTemplate(entry) {

    return { ...entry };
}


function normalizeTemplate(raw, existing = null, now = Date.now()) {

    if (!raw || typeof raw !== "object") {
        throw new Error("Template payload must be an object.");
    }

    const name = String(raw.name ?? "").trim();
    const content = String(raw.content ?? "").replace(/\r\n?/g, "\n");

    if (!name) {
        throw new Error("Template name is required.");
    }

    if (content.trim() === "") {
        throw new Error("Template task description cannot be empty.");
    }

    const description = String(raw.description ?? "").trim();
    const category = String(raw.category ?? "").trim() || "General";
    const mode = VALID_MODES.has(raw.mode) ? raw.mode : null;
    const effort = VALID_EFFORTS.has(raw.effort) ? raw.effort : null;

    return {
        id: existing ? existing.id : String(raw.id || makeId(name)).trim(),
        name,
        description,
        content,
        category,
        mode,
        effort,
        createdAt: existing ? existing.createdAt : (Number(raw.createdAt) || now),
        updatedAt: now,
        usageCount: existing
            ? Math.max(0, Number(raw.usageCount ?? existing.usageCount) || 0)
            : Math.max(0, Number(raw.usageCount) || 0)
    };
}


export function createTaskTemplateService({ storage = null, key = TASK_TEMPLATES_KEY } = {}) {

    let memoryFallback = [];

    function resolvedStorage() {

        return storage || defaultStorage();
    }

    function readRaw() {

        const target = resolvedStorage();
        if (!target) return memoryFallback.map(cloneTemplate);

        try {
            const raw = target.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(item => item && typeof item === "object" && item.id && item.name && item.content);
        } catch {
            return [];
        }
    }

    function writeRaw(items) {

        const clean = items.map(cloneTemplate);
        memoryFallback = clean;

        const target = resolvedStorage();
        if (!target) return;

        try {
            if (clean.length === 0) target.removeItem(key);
            else target.setItem(key, JSON.stringify(clean));
        } catch {
            /* storage quota or private mode */
        }
    }

    function list() {

        return readRaw()
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name))
            .map(cloneTemplate);
    }

    function get(idOrName) {

        const query = String(idOrName ?? "").trim();
        if (!query) return null;

        const items = readRaw();
        const lower = query.toLowerCase();
        const found =
            items.find(item => item.id === query) ||
            items.find(item => String(item.name || "").trim().toLowerCase() === lower);

        return found ? cloneTemplate(found) : null;
    }

    function save(input, options = {}) {

        const items = readRaw();
        const requestedId = input && input.id ? String(input.id).trim() : "";
        const existingIndex = requestedId ? items.findIndex(item => item.id === requestedId) : -1;
        const existing = existingIndex >= 0 ? items[existingIndex] : null;

        const candidate = normalizeTemplate(input, existing);
        const lowerName = candidate.name.toLowerCase();

        const duplicateIndex = items.findIndex(
            item => item.id !== candidate.id && String(item.name || "").trim().toLowerCase() === lowerName
        );

        if (duplicateIndex >= 0) {
            if (!options.overwrite) {
                throw new Error(`A template named "${candidate.name}" already exists.`);
            }
            const merged = normalizeTemplate(
                { ...candidate, id: items[duplicateIndex].id, usageCount: items[duplicateIndex].usageCount },
                items[duplicateIndex]
            );
            items[duplicateIndex] = merged;
            writeRaw(items);
            return cloneTemplate(merged);
        }

        if (existingIndex >= 0) {
            items[existingIndex] = candidate;
        } else {
            items.push(candidate);
        }

        writeRaw(items);
        return cloneTemplate(candidate);
    }

    function remove(id) {

        const targetId = String(id ?? "").trim();
        if (!targetId) return false;

        const items = readRaw();
        const next = items.filter(item => item.id !== targetId);

        if (next.length === items.length) {
            return false;
        }

        writeRaw(next);
        return true;
    }

    function search(query) {

        const wanted = String(query ?? "").trim().toLowerCase();
        const items = list();
        if (!wanted) return items;

        return items.filter(item =>
            item.name.toLowerCase().includes(wanted) ||
            item.category.toLowerCase().includes(wanted) ||
            item.description.toLowerCase().includes(wanted) ||
            item.content.toLowerCase().includes(wanted)
        );
    }

    function recordUse(id) {

        const targetId = String(id ?? "").trim();
        if (!targetId) return null;

        const items = readRaw();
        const index = items.findIndex(item => item.id === targetId);
        if (index < 0) return null;

        const updated = {
            ...items[index],
            usageCount: Math.max(0, Number(items[index].usageCount) || 0) + 1,
            updatedAt: Date.now()
        };
        items[index] = updated;
        writeRaw(items);
        return cloneTemplate(updated);
    }

    function clear() {

        writeRaw([]);
    }

    function exportJson(customList = null) {

        const items = Array.isArray(customList) ? customList : list();
        return JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
            templates: items
        }, null, 2);
    }

    function parseTemplatesPayload(jsonString) {

        if (typeof jsonString !== "string" || !jsonString.trim()) {
            throw new Error("Invalid or empty template JSON.");
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        } catch (err) {
            throw new Error(`Invalid JSON format: ${err.message || "Parse error"}`);
        }

        const candidateList = Array.isArray(parsed)
            ? parsed
            : (parsed && Array.isArray(parsed.templates)
                ? parsed.templates
                : (parsed && typeof parsed === "object" && (parsed.name || parsed.content) ? [parsed] : null));

        if (!candidateList || candidateList.length === 0) {
            throw new Error("No templates found in JSON data.");
        }

        return candidateList;
    }

    function inspectImport(jsonString) {

        const candidateList = parseTemplatesPayload(jsonString);
        const existing = readRaw();
        const byId = new Map(existing.map(item => [item.id, item]));
        const byName = new Map(existing.map(item => [String(item.name || "").trim().toLowerCase(), item]));
        const conflicts = [];

        for (const raw of candidateList) {
            if (!raw || typeof raw !== "object") continue;
            const rawId = raw.id ? String(raw.id).trim() : "";
            const rawName = String(raw.name ?? "").trim();
            const lowerName = rawName.toLowerCase();
            const matchById = rawId ? byId.get(rawId) : null;
            const matchByName = lowerName ? byName.get(lowerName) : null;
            if (matchById || matchByName) {
                conflicts.push({
                    id: rawId || null,
                    name: rawName || matchById?.name || "Unnamed",
                    reason: matchById ? "id" : "name",
                    existingName: (matchById || matchByName).name
                });
            }
        }

        return { candidateList, conflicts };
    }

    function importJson(jsonString, options = {}) {

        const candidateList = parseTemplatesPayload(jsonString);
        const skipDuplicates = options.skipDuplicates === true;
        const overwrite = skipDuplicates ? false : options.overwrite !== false;
        const results = {
            imported: 0,
            skipped: 0,
            failed: 0,
            total: candidateList.length,
            items: [],
            errors: []
        };

        for (const raw of candidateList) {
            try {
                if (skipDuplicates && raw && typeof raw === "object") {
                    const existing = readRaw();
                    const rawId = raw.id ? String(raw.id).trim() : "";
                    const lowerName = String(raw.name ?? "").trim().toLowerCase();
                    const hasDuplicate = existing.some(
                        item => (rawId && item.id === rawId) || (lowerName && String(item.name || "").trim().toLowerCase() === lowerName)
                    );
                    if (hasDuplicate) {
                        results.skipped++;
                        continue;
                    }
                }
                const saved = save(raw, { overwrite });
                results.imported++;
                results.items.push(saved);
            } catch (err) {
                results.failed++;
                results.errors.push(err.message || String(err));
            }
        }

        return results;
    }

    return {
        list,
        get,
        save,
        remove,
        search,
        recordUse,
        clear,
        exportJson,
        inspectImport,
        importJson
    };
}


export const taskTemplates = createTaskTemplateService();

export const listTemplates = () => taskTemplates.list();
export const getTemplate = idOrName => taskTemplates.get(idOrName);
export const saveTemplate = (input, options) => taskTemplates.save(input, options);
export const deleteTemplate = id => taskTemplates.remove(id);
export const matchTemplates = query => taskTemplates.search(query);
export const markTemplateUsed = id => taskTemplates.recordUse(id);
export const clearTemplates = () => taskTemplates.clear();
export const exportTemplatesJson = customList => taskTemplates.exportJson(customList);
export const inspectTemplateImport = jsonString => taskTemplates.inspectImport(jsonString);
export const importTemplatesFromJson = (jsonString, options) => taskTemplates.importJson(jsonString, options);
