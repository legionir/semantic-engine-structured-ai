"use strict";

/* Command registry — EXECUTION_PLAN Phase 26. */

class CommandRegistry {
    constructor(commands = {}) {
        this.commands = new Map();
        Object.entries(commands).forEach(([name, command]) => this.register(name, command));
    }

    register(name, command) {
        if (!name || !command) throw new Error("a command name and handler are required");
        this.commands.set(name, command);
        return command;
    }

    get(name) {
        return this.commands.get(name) || null;
    }

    has(name) {
        return this.commands.has(name);
    }

    names() {
        return [...this.commands.keys()];
    }

    async execute(name, ...args) {
        const command = this.get(name);
        if (!command || typeof command.execute !== "function") {
            throw new Error(`unknown CLI command: ${name}`);
        }
        return command.execute(...args);
    }
}


module.exports = {
    CommandRegistry
};
