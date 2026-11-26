const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
    path.join(__dirname, "../../web/public/app/project-routing.js"),
    "utf8"
);
const start = source.indexOf("function navigateConsole(");
const end = source.indexOf("export function projectById(", start);
assert(start >= 0 && end > start, "navigateConsole should be present");

const calls = [];
const location = {};
Object.defineProperties(location, {
    pathname: {
        get() { return "/"; },
        set() { throw new Error("SPA navigation must not assign location.pathname"); }
    },
    search: {
        get() { return ""; },
        set() { throw new Error("SPA navigation must not assign location.search"); }
    }
});
const history = {
    pushState(state, title, url) { calls.push({ method: "pushState", state, title, url }); },
    replaceState(state, title, url) { calls.push({ method: "replaceState", state, title, url }); }
};
const context = {
    URL,
    globalThis: null,
    browserLocation: () => location,
    browserHistory: () => history
};
context.globalThis = context;
vm.runInNewContext(source.slice(start, end), context);

context.navigateConsole("prj-new-pr-c84eba96", "overview", false);
assert.strictEqual(JSON.stringify(calls[0]), JSON.stringify({
    method: "pushState",
    state: { projectId: "prj-new-pr-c84eba96", tab: "overview" },
    title: "",
    url: "/projects/prj-new-pr-c84eba96"
}));

context.navigateConsole("prj-new-pr-c84eba96", "activity", true);
assert.strictEqual(JSON.stringify(calls[1]), JSON.stringify({
    method: "replaceState",
    state: { projectId: "prj-new-pr-c84eba96", tab: "activity" },
    title: "",
    url: "/projects/prj-new-pr-c84eba96?tab=activity"
}));

console.log("console navigation tests passed");
