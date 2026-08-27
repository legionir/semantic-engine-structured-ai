"use strict";

/*
|--------------------------------------------------------------------------
| File info (legacy wrapper) — EXECUTION_PLAN Phase 19
|--------------------------------------------------------------------------
|
| Implementation lives in filesystem/FileMetadataTools.js. This file
| keeps the historical require("./tools/fileinfo") path until Phase 30.
|--------------------------------------------------------------------------
*/

const FileMetadataTools = require("./filesystem/FileMetadataTools");

module.exports = {
    fs_info: FileMetadataTools.fs_info
};
