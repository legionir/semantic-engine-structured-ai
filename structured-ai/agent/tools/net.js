const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");

const { truncateText } = require("../lib/workspace");

const settings = require("../lib/storage");


/*
|--------------------------------------------------------------------------
| Network
|--------------------------------------------------------------------------
|
| Reading a URL is a separate capability from reading a file. Keeping it
| in its own tool means a profile can grant filesystem access without
| granting network access.
|
| The target address is resolved and checked before the request is sent,
| and again after every redirect, so an agent cannot use this tool to
| reach loopback services, cloud metadata endpoints, or the private
| network the runtime happens to sit in.
|--------------------------------------------------------------------------
*/

const ALLOWED_PROTOCOLS = [
    "http:",
    "https:"
];





function ipv4ToInteger(address) {

    return address
        .split(".")
        .reduce(
            (total, part) =>
                (total << 8) + Number(part),
            0
        ) >>> 0;
}


const BLOCKED_IPV4_RANGES = [
    ["0.0.0.0", 8, "unspecified"],
    ["10.0.0.0", 8, "private"],
    ["100.64.0.0", 10, "carrier-grade NAT"],
    ["127.0.0.0", 8, "loopback"],
    ["169.254.0.0", 16, "link-local or cloud metadata"],
    ["172.16.0.0", 12, "private"],
    ["192.0.0.0", 24, "protocol assignments"],
    ["192.168.0.0", 16, "private"],
    ["198.18.0.0", 15, "benchmarking"],
    ["224.0.0.0", 4, "multicast"],
    ["240.0.0.0", 4, "reserved"]
];


function classifyIpv4(address) {

    const value =
        ipv4ToInteger(address);

    for (
        const [base, bits, label]
        of BLOCKED_IPV4_RANGES
    ) {

        const mask =
            bits === 0
                ? 0
                : (0xffffffff << (32 - bits)) >>> 0;

        if (
            (value & mask) ===
            (ipv4ToInteger(base) & mask)
        ) {
            return label;
        }
    }

    return null;
}


function classifyIpv6(address) {

    const normalised =
        address.toLowerCase().split("%")[0];

    if (
        normalised === "::1" ||
        normalised === "::"
    ) {
        return "loopback";
    }

    /*
    | IPv4-mapped addresses such as ::ffff:127.0.0.1 must be judged by
    | their IPv4 value, not by their textual form.
    */

    const mapped =
        /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);

    if (mapped) {
        return classifyIpv4(mapped[1]);
    }

    const firstGroup =
        parseInt(
            normalised.split(":")[0] || "0",
            16
        );

    if ((firstGroup & 0xfe00) === 0xfc00) {
        return "unique local";
    }

    if ((firstGroup & 0xffc0) === 0xfe80) {
        return "link-local";
    }

    return null;
}


function classifyAddress(address) {

    const version =
        net.isIP(address);

    if (version === 4) {
        return classifyIpv4(address);
    }

    if (version === 6) {
        return classifyIpv6(address);
    }

    return null;
}


async function assertHostIsReachable(url) {

    const hostname = url.hostname.toLowerCase();

    if (url.username || url.password) {
        throw new Error("Credentials embedded in a URL are not allowed.");
    }

    const literal =
        hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;

    let resolved;
    if (net.isIP(literal)) {
        resolved = [{ address: literal }];
    } else {
        try {
            resolved = await dns.lookup(literal, { all: true });
        } catch (error) {
            throw new Error(
                `Host could not be resolved: ${literal} (${error.code || error.message})`
            );
        }
    }

    const addresses = resolved.map(entry => entry.address);
    if (addresses.length === 0) {
        throw new Error(`Host could not be resolved: ${literal}`);
    }

    const exempt =
        allowedHosts().includes(hostname) ||
        privateNetworkAllowed();

    if (!exempt) {
        for (const address of addresses) {
            const label = classifyAddress(address);
            if (label) {
                throw new Error(
                    `Blocked request to ${literal} (${address} is ${label}). Set ALLOW_PRIVATE_NETWORK=1 or list the host in NET_ALLOWED_HOSTS to override.`
                );
            }
        }
    }

    /* The caller must connect to one of these checked addresses, rather
       than resolving the hostname a second time through fetch. */
    return { addresses, literal };
}


function readNodeResponse(response, limit) {

    return new Promise((resolve, reject) => {
        let text = "";
        let bytes = 0;
        let truncated = false;

        response.on("data", chunk => {
            bytes += chunk.length;
            if (text.length < limit) {
                const remaining = limit - text.length;
                const part = chunk.toString("utf8");
                text += part.slice(0, remaining);
                if (part.length > remaining) truncated = true;
            } else {
                truncated = true;
            }
        });

        response.on("end", () => resolve({ text, bytes, truncated }));
        response.on("error", reject);
    });
}


function requestPinned(url, args, address, controller) {

    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const headers = {
            ...(args.headers && typeof args.headers === "object" ? args.headers : {}),
            host: url.host,
        };
        const options = {
            protocol: url.protocol,
            hostname: address,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: args.method === "POST" ? "POST" : "GET",
            headers,
            ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
        };

        const request = transport.request(options, response => resolve(response));
        const abort = () => {
            const error = new Error("request aborted");
            error.name = "AbortError";
            request.destroy(error);
        };
        if (controller.signal.aborted) {
            abort();
        } else {
            controller.signal.addEventListener("abort", abort, { once: true });
        }
        request.on("error", error => reject(error));
        if (options.method === "POST" && args.body !== undefined) {
            request.write(args.body);
        }
        request.end();
    });
}

function responseLimit() {
    return settings.get("MAX_HTTP_RESPONSE_CHARS");
}

function redirectLimit() {
    return settings.get("MAX_HTTP_REDIRECTS");
}

function privateNetworkAllowed() {
    return settings.get("ALLOW_PRIVATE_NETWORK") === true;
}

function allowedHosts() {

    return settings.get("NET_ALLOWED_HOSTS")
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}


async function netFetch(args) {

    if (typeof args.url !== "string") {

        throw new Error(
            "url is required."
        );
    }

    let url;

    try {

        url = new URL(args.url);

    } catch {

        throw new Error(
            `Invalid URL: ${args.url}`
        );
    }

    const method =
        args.method === "POST"
            ? "POST"
            : "GET";

    const timeout =
        Number.isInteger(args.timeout_ms)
            ? args.timeout_ms
            : 15000;

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            timeout
        );

    const redirects = [];

    try {

        let current = url;

        for (;;) {

            if (!ALLOWED_PROTOCOLS.includes(current.protocol)) {

                throw new Error(
                    `Unsupported protocol: ${current.protocol}`
                );
            }

            const reachable =
                await assertHostIsReachable(current);

            const response =
                await requestPinned(
                    current,
                    { ...args, method },
                    reachable.addresses[0],
                    controller
                );

            const location =
                response.headers.location
                    ? Array.isArray(response.headers.location)
                        ? response.headers.location[0]
                        : response.headers.location
                    : null;

            if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                location
            ) {

                if (redirects.length >= redirectLimit()) {

                    throw new Error(
                        `Too many redirects (limit ${redirectLimit()}).`
                    );
                }

                const next =
                    new URL(location, current);

                redirects.push({
                    from:
                        current.toString(),

                    to:
                        next.toString(),

                    status:
                        response.statusCode
                });

                current = next;

                continue;
            }

            const contentType =
                response.headers["content-type"] || "";

            const received =
                await readNodeResponse(
                    response,
                    responseLimit()
                );

            const raw = received.text;
            const capped = {
                text: raw,
                truncated: received.truncated || raw.length > responseLimit()
            };

            return {
                url:
                    current.toString(),

                requested_url:
                    url.toString(),

                method,

                status:
                    response.statusCode,

                ok:
                    response.statusCode >= 200 && response.statusCode < 300,

                content_type:
                    contentType,

                content_length:
                    received.bytes,

                redirects,

                truncated:
                    capped.truncated,

                body:
                    capped.text
            };
        }

    } catch (error) {

        if (error.name === "AbortError") {

            throw new Error(
                `Request timed out after ${timeout} ms: ${url}`
            );
        }

        throw error;

    } finally {

        clearTimeout(timer);
    }
}


module.exports = {
    net_fetch: netFetch,

    _classifyAddress: classifyAddress
};
