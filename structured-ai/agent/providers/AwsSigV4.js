"use strict";

/*
|--------------------------------------------------------------------------
| AWS Signature Version 4 (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Used by the Bedrock adapter when it is given IAM credentials instead of
| a Bedrock API key. Non-S3 services sign the path with every segment
| encoded twice (a model id such as "...-v1:0" travels as %3A and is
| signed as %253A). The host header is signed but not returned: fetch
| derives the same value from the URL.
|--------------------------------------------------------------------------
*/

const crypto = require("crypto");


function hmac(key, data) {
    return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}


function sha256(data) {
    return crypto.createHash("sha256").update(data || "", "utf8").digest("hex");
}


function encodeRfc3986(value) {

    return encodeURIComponent(value).replace(
        /[!'()*]/g,
        character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}


function amzDateOf(now) {
    return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}


function signRequest({
    method = "POST",
    url,
    headers = {},
    body = "",
    region,
    service,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    now = new Date()
}) {

    const target = new URL(url);

    const amzDate = amzDateOf(now);
    const date = amzDate.slice(0, 8);

    const signed = {};

    for (const [name, value] of Object.entries(headers)) {

        const key = name.toLowerCase();

        if (key !== "authorization") {
            signed[key] = value;
        }
    }

    signed.host = target.host;
    signed["x-amz-date"] = amzDate;

    if (sessionToken) {
        signed["x-amz-security-token"] = sessionToken;
    }

    const names = Object.keys(signed).sort();

    const canonicalHeaders =
        names
            .map(name => `${name}:${String(signed[name]).trim().replace(/\s+/g, " ")}\n`)
            .join("");

    const signedHeaders = names.join(";");

    const canonicalUri =
        target.pathname
            .split("/")
            .map(segment => encodeRfc3986(segment))
            .join("/") || "/";

    const canonicalQuery =
        [...target.searchParams.entries()]
            .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
            .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
            .map(([key, value]) => `${key}=${value}`)
            .join("&");

    const canonicalRequest = [
        method.toUpperCase(),
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        sha256(body)
    ].join("\n");

    const scope = `${date}/${region}/${service}/aws4_request`;

    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        scope,
        sha256(canonicalRequest)
    ].join("\n");

    const signingKey =
        hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");

    const signature =
        crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    const result = { ...headers, "x-amz-date": amzDate };

    if (sessionToken) {
        result["x-amz-security-token"] = sessionToken;
    }

    result.authorization =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return result;
}


module.exports = {
    signRequest
};
