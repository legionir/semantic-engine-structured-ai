"use strict";

const crypto = require("crypto");
const settings = require("../config");


function itemKey(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .slice(0, 160);
}


function itemHash(value) {

    return crypto
        .createHash("sha256")
        .update(String(value || ""), "utf8")
        .digest("hex");
}


function sanitizeItemProvenance(records, fields) {

    if (!Array.isArray(records)) {
        return [];
    }

    const maximum = settings.get("MEMORY_PROVENANCE_MAX_ITEMS");

    if (maximum === 0) {
        return [];
    }

    return records
        .filter(record =>
            record &&
            typeof record === "object" &&
            fields.includes(record.field) &&
            /^[a-f0-9]{64}$/i.test(record.item_hash || "")
        )
        .slice(-maximum)
        .map(record => ({
            field: record.field,
            item_hash: record.item_hash.toLowerCase(),
            run_id: typeof record.run_id === "string"
                ? record.run_id.slice(0, 160)
                : null,
            source: "transcript-fold",
            exchange_count: Math.max(0, Number(record.exchange_count) || 0),
            tools: Array.isArray(record.tools)
                ? [...new Set(record.tools
                    .filter(tool => typeof tool === "string")
                    .map(tool => tool.slice(0, 100)))].slice(0, 50)
                : [],
            source_refs: Array.isArray(record.source_refs)
                ? [...new Set(record.source_refs
                    .filter(ref => typeof ref === "string")
                    .map(ref => ref.slice(0, 160)))].slice(0, settings.get("MEMORY_PROVENANCE_MAX_SOURCE_REFS"))
                : [],
            recorded_at: typeof record.recorded_at === "string"
                ? record.recorded_at.slice(0, 40)
                : null
        }));
}


function preserveForMemory(records, memory, fields) {

    const valid = new Set();
    for (const field of fields) {
        for (const value of memory[field] || []) {
            valid.add(`${field}:${itemHash(value)}`);
        }
    }

    return sanitizeItemProvenance(records, fields)
        .filter(record => valid.has(`${record.field}:${record.item_hash}`));
}


function appendFoldProvenance(previous, next, fields, metadata) {

    const records = Array.isArray(previous.item_provenance)
        ? previous.item_provenance.slice()
        : [];

    for (const field of fields) {
        const before = new Set((previous[field] || []).map(itemKey));
        for (const value of next[field] || []) {
            if (before.has(itemKey(value))) {
                continue;
            }
            records.push({
                field,
                item_hash: itemHash(value),
                run_id: metadata.run_id || null,
                source: "transcript-fold",
                exchange_count: metadata.exchange_count,
                tools: metadata.tools,
                source_refs: metadata.source_refs,
                recorded_at: metadata.recorded_at
            });
        }
    }

    return preserveForMemory(records, next, fields);
}


module.exports = {
    itemHash,
    sanitizeItemProvenance,
    preserveForMemory,
    appendFoldProvenance
};
