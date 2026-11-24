"use strict";

const settings = require("../config");
const { FIELDS } = require("../persistence/MemoryRepository");

function mergeLists(previous, incoming, limit) {

    const seen = new Map();

    for (
        const value
        of [...(previous || []), ...(incoming || [])]
    ) {

        if (typeof value !== "string") {
            continue;
        }

        const text = value.trim();

        if (text === "") {
            continue;
        }

        const key =
            text
                .toLowerCase()
                .replace(/\s+/g, " ")
                .slice(0, 160);

        seen.set(key, text);
    }

    const merged = [...seen.values()];

    return merged.length > limit
        ? merged.slice(merged.length - limit)
        : merged;
}


function mergeMemory(previous, incoming) {

    const limit =
        settings.get("MEMORY_MAX_ITEMS");

    const memory = {
        version: 1,

        updated_at: previous.updated_at,

        chunks_absorbed:
            (previous.chunks_absorbed || 0) + 1,

        provenance:
            Array.isArray(previous.provenance)
                ? previous.provenance.slice(-100)
                : [],

        item_provenance:
            Array.isArray(previous.item_provenance) &&
            settings.get("MEMORY_PROVENANCE_MAX_ITEMS") > 0
                ? previous.item_provenance.slice(
                    -settings.get("MEMORY_PROVENANCE_MAX_ITEMS")
                )
                : []
    };

    for (const field of FIELDS) {

        memory[field] =
            mergeLists(
                previous[field],
                incoming ? incoming[field] : [],
                limit
            );
    }

    return memory;
}


module.exports = { mergeLists, mergeMemory };
