"use strict";

module.exports = {
    ...require("./BaseController"),
    ...require("./TaskController"),
    ...require("./SessionController"),
    ...require("./StateController"),
    ...require("./SettingsController"),
    ...require("./ApprovalController"),
    ...require("./McpController"),
    ...require("./ArchiveController"),
    ...require("./PlanController"),
    ...require("./ProjectController"),
    ...require("./RunController"),
    ...require("./DiscussionController")
};
