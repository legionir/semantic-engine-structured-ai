/*
|--------------------------------------------------------------------------
| Extensible slash command service
|--------------------------------------------------------------------------
|
| Registry, provider hook, matcher, parser and dispatcher for "/" commands
| entered in the message composer. New built-in commands or dynamic
| providers (such as MCP prompts) register here without changing the
| composer or mention controller.
*/


function normalizeName(name) {

    return String(name ?? "").trim().replace(/^\/+/, "").toLowerCase();
}


function normalizeDefinition(definition) {

    if (!definition || typeof definition !== "object") {
        throw new Error("Slash command definition must be an object");
    }

    const name = normalizeName(definition.name);

    if (!name || /\s/.test(name)) {
        throw new Error(`Invalid slash command name: "${definition.name}"`);
    }

    if (typeof definition.execute !== "function") {
        throw new Error(`Slash command "/${name}" must define an execute(args, ctx) handler`);
    }

    const aliases = Array.isArray(definition.aliases)
        ? [...new Set(definition.aliases.map(normalizeName).filter(alias => alias && alias !== name && !/\s/.test(alias)))]
        : [];

    return {
        ...definition,
        name,
        aliases,
        description: String(definition.description || "").trim(),
        usage: String(definition.usage || `/${name}`).trim(),
        category: String(definition.category || "General").trim(),
        type: definition.type || "command",
        acceptsArgs: Boolean(definition.acceptsArgs)
    };
}


export function parseSlashInput(input) {

    const raw = String(input ?? "");
    const trimmed = raw.trim();

    if (!trimmed.startsWith("/")) return null;

    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);

    if (!match) {
        return { raw: trimmed, name: "", args: "", isPathLike: false };
    }

    const token = match[1];

    return {
        raw: trimmed,
        name: normalizeName(token),
        args: String(match[2] || "").trim(),
        isPathLike: token.includes("/")
    };
}


export function createSlashCommandRegistry() {

    const commands = new Map();
    const providers = new Set();

    function unregister(name) {

        const key = normalizeName(name);
        return commands.delete(key);
    }

    function register(definition) {

        const normalized = normalizeDefinition(definition);
        commands.set(normalized.name, normalized);

        return () => {
            if (commands.get(normalized.name) === normalized) {
                commands.delete(normalized.name);
            }
        };
    }

    function registerProvider(provider) {

        if (typeof provider !== "function") {
            throw new Error("Slash command provider must be a function");
        }

        providers.add(provider);

        return () => {
            providers.delete(provider);
        };
    }

    async function all() {

        const merged = new Map();

        for (const [name, command] of commands.entries()) {
            merged.set(name, command);
        }

        for (const provider of [...providers]) {
            try {
                const provided = await provider();
                if (!Array.isArray(provided)) continue;
                for (const item of provided) {
                    if (!item || typeof item !== "object") continue;
                    try {
                        const normalized = normalizeDefinition(item);
                        if (!merged.has(normalized.name)) {
                            merged.set(normalized.name, normalized);
                        }
                    } catch {
                        /* ignore malformed dynamic item */
                    }
                }
            } catch {
                /* a failing provider never blocks built-in commands */
            }
        }

        return [...merged.values()];
    }

    async function get(name) {

        const target = normalizeName(name);
        if (!target) return null;

        const list = await all();

        return list.find(cmd => cmd.name === target || cmd.aliases.includes(target)) || null;
    }

    async function match(query, limit = 25) {

        const wanted = normalizeName(query);
        const list = await all();

        const scored = [];

        for (const cmd of list) {
            const path = `/${cmd.name}`;

            if (!wanted) {
                scored.push({ rank: 0, item: { ...cmd, path } });
                continue;
            }

            const nameMatch = cmd.name.indexOf(wanted);
            const aliasMatch = cmd.aliases.some(alias => alias.startsWith(wanted))
                ? 0
                : cmd.aliases.some(alias => alias.includes(wanted))
                    ? 1
                    : -1;
            const descMatch = cmd.description.toLowerCase().includes(wanted);
            const catMatch = cmd.category.toLowerCase().includes(wanted);

            if (nameMatch === 0 || aliasMatch === 0) {
                scored.push({ rank: 0, item: { ...cmd, path } });
            } else if (nameMatch > 0 || aliasMatch > 0) {
                scored.push({ rank: 1, item: { ...cmd, path } });
            } else if (descMatch || catMatch) {
                scored.push({ rank: 2, item: { ...cmd, path } });
            }
        }

        scored.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));

        return scored.slice(0, limit).map(entry => entry.item);
    }

    async function execute(input, context = {}) {

        const parsed = parseSlashInput(input);
        if (!parsed) return { handled: false };

        if (!parsed.name) {
            return {
                handled: true,
                ok: false,
                error: "Type a command after /, for example /help."
            };
        }

        const command = await get(parsed.name);

        if (!command) {
            if (parsed.isPathLike) {
                return { handled: false };
            }
            const message = `Unknown command: /${parsed.name}. Type /help to see available commands.`;
            context.onUnknown?.(parsed, message);
            return { handled: true, ok: false, error: message, parsed };
        }

        try {
            const value = await command.execute(parsed.args, {
                ...context,
                command,
                args: parsed.args,
                parsed,
                registry: api
            });

            return { handled: true, ok: true, command, parsed, value };
        } catch (error) {
            return {
                handled: true,
                ok: false,
                error: error?.message || `Failed to run /${command.name}`,
                command,
                parsed
            };
        }
    }

    const api = {
        register,
        unregister,
        registerProvider,
        get,
        all,
        match,
        parse: parseSlashInput,
        execute
    };

    return api;
}


export const slashCommands = createSlashCommandRegistry();

export const registerCommand = definition => slashCommands.register(definition);
export const unregisterCommand = name => slashCommands.unregister(name);
export const registerCommandProvider = provider => slashCommands.registerProvider(provider);
export const getCommand = name => slashCommands.get(name);
export const listCommands = () => slashCommands.all();
export const matchCommands = (query, limit) => slashCommands.match(query, limit);
export const executeSlashCommand = (input, context) => slashCommands.execute(input, context);
