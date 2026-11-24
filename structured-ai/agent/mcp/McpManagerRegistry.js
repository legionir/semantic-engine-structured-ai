"use strict";

/* One MCP manager per canonical project workspace, plus the active-project facade. */

const path = require("path");

function createMcpManagerRegistry({ McpManager, settings, currentProject }) {
function canonicalRoot(root) {

    const path = require("path");

    return path.resolve(String(root));
}


class McpManagerRegistry {

    constructor() {

        this.instances = new Map();
    }


    rootForActiveProject() {

        const project = currentProject();

        if (!project) {

            return settings.get("WORKSPACE_ROOT") || process.cwd();
        }

        const root = project.workspaceRoot || project.rootPath;

        if (!root) {

            throw new Error(
                `MCP: project ${project.projectId ?? project.id ?? "(unknown)"} has no workspaceRoot; refusing to fall back to another workspace.`
            );
        }

        return root;
    }


    forRoot(root) {

        const key = canonicalRoot(root);

        let instance = this.instances.get(key);

        if (!instance) {

            instance = new McpManager(key);

            this.instances.set(key, instance);
        }

        return instance;
    }


    current() {

        return this.forRoot(this.rootForActiveProject());
    }


    /* All projects' servers are closed together on process shutdown. */
    async shutdown() {

        await Promise.all(
            [...this.instances.values()].map(instance => instance.shutdown())
        );

        this.instances.clear();
    }
}


const registry = new McpManagerRegistry();


const manager = new Proxy(registry, {

    get(target, property) {

        if (property in target) {

            const own = target[property];

            return typeof own === "function" ? own.bind(target) : own;
        }

        const instance = target.current();

        const value = instance[property];

        return typeof value === "function" ? value.bind(instance) : value;
    },

    set(target, property, value) {

        if (property in target) {

            target[property] = value;

            return true;
        }

        target.current()[property] = value;

        return true;
    }
});



    return { manager, McpManagerRegistry, managerRegistry: registry };
}

module.exports = { createMcpManagerRegistry };
