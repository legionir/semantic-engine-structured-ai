"use strict";

const settings = require("../../agent/config");


function tooLarge(message) {

    const error = new Error(message);
    error.status = 413;
    return error;
}


function parameter(header, name) {

    const expression = new RegExp(`(?:^|;)\\s*${name}="((?:\\\\.|[^"])*)"`, "i");
    const match = String(header || "").match(expression);

    return match
        ? match[1].replace(/\\([\\"])/g, "$1")
        : null;
}


function findBoundary(buffer, marker, from) {

    let index = buffer.indexOf(marker, from);

    while (index !== -1) {
        const after = index + marker.length;
        if (buffer.subarray(after, after + 2).toString() === "--" ||
            buffer.subarray(after, after + 2).toString() === "\r\n") {
            return index;
        }
        index = buffer.indexOf(marker, index + 2);
    }

    return -1;
}


function parseMultipart(buffer, boundary, {
    maxFileBytes = settings.get("UPLOAD_MAX_FILE_BYTES"),
    maxFiles = settings.get("UPLOAD_MAX_FILES")
} = {}) {

    const delimiter = Buffer.from(`--${boundary}`);
    const marker = Buffer.from(`\r\n--${boundary}`);
    const fields = Object.create(null);
    const files = [];
    let cursor = 0;

    if (buffer.subarray(0, delimiter.length).compare(delimiter) !== 0) {
        throw new Error("malformed multipart body: opening boundary is missing");
    }

    while (cursor < buffer.length) {
        cursor += delimiter.length;

        if (buffer.subarray(cursor, cursor + 2).toString() === "--") {
            break;
        }
        if (buffer.subarray(cursor, cursor + 2).toString() !== "\r\n") {
            throw new Error("malformed multipart body: invalid boundary separator");
        }
        cursor += 2;

        const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
        if (headerEnd === -1) throw new Error("malformed multipart body: part headers are incomplete");

        const headers = Object.create(null);
        for (const line of buffer.subarray(cursor, headerEnd).toString("utf8").split("\r\n")) {
            const colon = line.indexOf(":");
            if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }

        const disposition = headers["content-disposition"] || "";
        if (!/^form-data\s*;/i.test(disposition)) {
            throw new Error("malformed multipart body: unsupported part disposition");
        }
        const fieldName = parameter(disposition, "name");
        if (!fieldName) throw new Error("malformed multipart body: part name is missing");

        const dataStart = headerEnd + 4;
        const boundaryStart = findBoundary(buffer, marker, dataStart);
        if (boundaryStart === -1) throw new Error("malformed multipart body: closing boundary is missing");
        const data = buffer.subarray(dataStart, boundaryStart);
        const filename = parameter(disposition, "filename");

        if (filename !== null) {
            if (files.length >= maxFiles) throw tooLarge(`too many uploaded files (maximum ${maxFiles})`);
            if (data.length > maxFileBytes) throw tooLarge(`uploaded file exceeds ${maxFileBytes} bytes`);
            files.push({
                fieldName,
                filename,
                contentType: headers["content-type"] || "application/octet-stream",
                data: Buffer.from(data)
            });
        } else {
            fields[fieldName] = data.toString("utf8");
        }

        cursor = boundaryStart + 2;
    }

    return { fields, files };
}


function readMultipart(req, {
    maxBytes = settings.get("UPLOAD_MAX_REQUEST_BYTES"),
    maxFileBytes = settings.get("UPLOAD_MAX_FILE_BYTES"),
    maxFiles = settings.get("UPLOAD_MAX_FILES")
} = {}) {

    const contentType = String(req.headers["content-type"] || "");
    const boundaryMatch = contentType.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);

    if (!boundary || boundary.length > 200) {
        return Promise.reject(new Error("content-type must be multipart/form-data with a valid boundary"));
    }

    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let rejected = false;

        req.on("data", chunk => {
            if (rejected) return;
            size += chunk.length;
            if (size > maxBytes) {
                rejected = true;
                req.resume?.();
                reject(tooLarge(`multipart request exceeds ${maxBytes} bytes`));
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => {
            if (rejected) return;
            try {
                resolve(parseMultipart(Buffer.concat(chunks, size), boundary, { maxFileBytes, maxFiles }));
            } catch (error) {
                reject(error);
            }
        });

        req.on("error", error => {
            if (!rejected) reject(error);
        });
    });
}


module.exports = {
    parseMultipart,
    readMultipart
};
