const fs = require("fs");
const path = require("path");

const settings = require("../lib/storage");

const events = require("../lib/events");

const { isInsideRoot, truncateText } = require("../lib/workspace");


/*
|--------------------------------------------------------------------------
| Skills On Demand
|--------------------------------------------------------------------------
|
| Every skill used to travel in every request: nine of them, 7.4K
| characters, whether the run touched git or not. That is the wrong
| trade twice. It taxes every iteration, and it caps how many skills the
| project can afford to have, which is the opposite of what a skill
| system is for.
|
| The prompt therefore carries the index, one line per skill, and the
| text arrives only when it is asked for:
|
|   available_skills   name and description        ~600 chars
|   skill_get          the full procedure          paid once, when used
|
| The file is read through its modification time, so editing a skill
| changes what the next call returns without a restart.
|--------------------------------------------------------------------------
*/

const SKILLS_FILE =
    path.join(__dirname, "..", "registry", "skills.json");

/*
| A skill that carries data lives in its own directory rather than in
| the registry file, because a house style, a checklist or a table is
| not something to paste into JSON:
|
|   agent/skills/<name>/skill.json      the same shape as a registry entry
|   agent/skills/<name>/resources/*     what it knows
|
| Resources are never inlined anywhere. skill_get lists them, skill_read
| returns one, and both are capped like any other tool result.
*/

const SKILLS_DIR =
    path.join(__dirname, "..", "skills");

const CACHE = {
    mtime: 0,
    dirMtime: 0,
    skills: []
};


function loadDirectorySkills() {

    if (!fs.existsSync(SKILLS_DIR)) {
        return [];
    }

    const skills = [];

    for (
        const entry
        of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    ) {

        if (!entry.isDirectory()) {
            continue;
        }

        const file =
            path.join(SKILLS_DIR, entry.name, "skill.json");

        if (!fs.existsSync(file)) {
            continue;
        }

        try {

            const skill =
                JSON.parse(fs.readFileSync(file, "utf8"));

            skill.directory = entry.name;

            skills.push(skill);

        } catch {

            /* a broken skill is skipped, never fatal */
        }
    }

    return skills;
}


function loadSkills() {

    const stats =
        fs.statSync(SKILLS_FILE);

    const dirStats =
        fs.existsSync(SKILLS_DIR)
            ? fs.statSync(SKILLS_DIR)
            : { mtimeMs: 0 };

    if (
        stats.mtimeMs !== CACHE.mtime ||
        dirStats.mtimeMs !== CACHE.dirMtime
    ) {

        CACHE.skills = [
            ...JSON.parse(
                fs.readFileSync(SKILLS_FILE, "utf8")
            ),
            ...loadDirectorySkills()
        ];

        CACHE.mtime = stats.mtimeMs;
        CACHE.dirMtime = dirStats.mtimeMs;
    }

    return CACHE.skills;
}


/*
| A resource is addressed by its declared id, never by a path from the
| model, and the file it names is resolved inside its own skill
| directory. "../../../etc/passwd" is refused by construction, and by a
| second check after resolution in case a symlink was involved.
*/

function resolveResource(skill, resourceId) {

    const declared =
        (skill.resources || []).find(
            item => item.id === resourceId
        );

    if (!declared) {

        throw new Error(
            `Unknown resource "${resourceId}" in skill ${skill.name}. It has: ${
                (skill.resources || [])
                    .map(item => `${item.id} (${item.title})`)
                    .join(", ") || "no resources"
            }.`
        );
    }

    const root =
        fs.realpathSync(
            path.join(SKILLS_DIR, skill.directory)
        );

    const target =
        path.resolve(root, declared.file);

    if (!isInsideRoot(root, target)) {

        throw new Error(
            `Resource "${resourceId}" points outside its skill directory.`
        );
    }

    const real =
        fs.realpathSync(target);

    if (!isInsideRoot(root, real)) {

        throw new Error(
            `Resource "${resourceId}" escapes its skill directory through a symlink.`
        );
    }

    return { declared, path: real };
}


/*
| What the prompt carries: enough to choose, never enough to work from.
*/

function skillIndex() {

    return loadSkills().map(
        skill => ({
            name: skill.name,
            description: skill.description
        })
    );
}


function skill_get(args = {}) {

    const requested =
        Array.isArray(args.names)
            ? args.names
            : args.name
                ? [args.name]
                : [];

    const skills = loadSkills();

    if (requested.length === 0) {

        throw new Error(
            `skill_get needs a name. Available skills: ${
                skills.map(skill => skill.name).join(", ")
            }.`
        );
    }

    const found = [];
    const missing = [];

    for (const name of requested) {

        const skill =
            skills.find(item => item.name === name);

        if (!skill) {

            missing.push(name);

            continue;
        }

        found.push(skill);
    }

    if (found.length === 0) {

        throw new Error(
            `Unknown skill: ${missing.join(", ")}. Available skills: ${
                skills.map(item => item.name).join(", ")
            }.`
        );
    }

    /*
    | Loading a skill is a decision worth seeing, so it is an event as
    | well as a result: the console marks the agent that loaded it.
    */

    events.emit("skill:loaded", {
        agent:
            args._agent || "main_agent",

        scope:
            args._agent || "main_agent",

        skills:
            found.map(skill => skill.name),

        chars:
            JSON.stringify(found).length
    });

    return {
        skills:
            found.map(skill => ({
                ...skill,

                directory: undefined,

                resources:
                    (skill.resources || []).map(
                        resource => ({
                            id: resource.id,
                            title: resource.title
                        })
                    )
            })),

        missing,

        note:
            (found.some(skill => (skill.resources || []).length > 0)
                ? "Read a listed resource with skill_read before deciding something it covers. "
                : "") +
            "Follow these instructions and constraints for as long as you are doing this kind of work."
    };
}


function skill_read(args = {}) {

    const skills = loadSkills();

    const skill =
        skills.find(item => item.name === args.name);

    if (!skill) {

        throw new Error(
            `Unknown skill: ${args.name}. Available skills: ${
                skills.map(item => item.name).join(", ")
            }.`
        );
    }

    if (!skill.directory) {

        throw new Error(
            `Skill ${skill.name} has no resources; its instructions are the whole of it.`
        );
    }

    const { declared, path: file } =
        resolveResource(skill, args.resource);

    const text =
        fs.readFileSync(file, "utf8");

    const lines =
        text.split("\n");

    const offset =
        Number.isInteger(args.offset)
            ? Math.max(0, args.offset)
            : 0;

    const limit =
        Number.isInteger(args.limit)
            ? args.limit
            : lines.length;

    const slice =
        lines.slice(offset, offset + limit).join("\n");

    const capped =
        truncateText(
            slice,
            settings.get("SKILL_RESOURCE_CHARS")
        );

    events.emit("skill:read", {
        agent:
            args._agent || "main_agent",

        skill: skill.name,

        resource: declared.id,

        chars: capped.text.length
    });

    return {
        skill: skill.name,

        resource: declared.id,

        title: declared.title,

        total_lines: lines.length,

        start_line: offset,

        end_line: Math.min(lines.length, offset + limit),

        truncated: capped.truncated,

        content: capped.text
    };
}


module.exports = {
    skill_get,
    skill_read,

    _loadSkills: loadSkills,
    _skillIndex: skillIndex
};
