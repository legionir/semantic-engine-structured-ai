"use strict";

/*
|--------------------------------------------------------------------------
| Auth, event stream and state
|--------------------------------------------------------------------------
|
| Password login and its status, the SSE event stream (with its snapshot)
| and the console state.
|
| Called in order by the console's request handler (ServerImplementation).
| It returns true once it has answered the request, false when the request
| is not one of its routes, so the next group gets it.
*/

const consoleAuth = require("../../../agent/config/ConsoleAuth");
const { CONSOLE_COOKIE } = require("../Middleware");
const { sendJson, setConsoleCookie } = require("../Response");
const { readBody } = require("../RequestBody");


module.exports = async function AuthAndStateRoutes(shared, request) {

    const {
        consolePasswordRequired,
        eventForClient,
        issuePasswordSession,
        loginRateLimiter,
        passwordMatches,
        projectSnapshot,
        snapshot,
        snapshotFor,
        sseHub,
        verifyConsoleToken
    } = shared;

    const {
        authLoginRoute,
        authStatusRoute,
        authenticated,
        claims,
        passwordSessionAuthenticated,
        pathname,
        req,
        res,
        trustedProxy,
        url
    } = request;

    if (authStatusRoute) {
        sendJson(res, 200, {
            passwordRequired: consolePasswordRequired,
            authenticated: consolePasswordRequired
                ? passwordSessionAuthenticated
                : Boolean(authenticated)
        });
        return true;
    }

    if (authLoginRoute) {
        if (!loginRateLimiter.allow(req)) {
            sendJson(res, 429, { error: "too many login attempts; try again later" });
            return true;
        }
        const body = await readBody(req, { maxBytes: 4096 });

        if (!consolePasswordRequired) {
            if (body.password !== undefined && body.token === undefined) {
                sendJson(res, 404, { error: "password login is disabled" });
                return true;
            }
            const candidate = typeof body.token === "string" ? body.token.trim() : "";
            if (!verifyConsoleToken || !verifyConsoleToken(candidate)) {
                sendJson(res, 401, { error: "invalid console token" });
                return true;
            }
            setConsoleCookie(res, CONSOLE_COOKIE, candidate, req, { trustForwarded: trustedProxy });
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (!passwordMatches(body.password)) {
            sendJson(res, 401, { error: "incorrect password" });
            return true;
        }
        const sessionToken = issuePasswordSession();
        setConsoleCookie(res, "structured_ai_console_password", sessionToken, req, { trustForwarded: trustedProxy });
        sendJson(res, 200, { ok: true, sessionToken });
        return true;
    }

    /* ---------------------------------------------- events */

    if (
        pathname === "/api/events" &&
        req.method === "GET"
    ) {

        const filterProjectId =
            url.searchParams.get("projectId");

        if (filterProjectId) {

            const allowed =
                consoleAuth.authorize(claims, {
                    projectId: filterProjectId,
                    permission: "project:read"
                });

            if (!allowed.ok) {

                sendJson(res, allowed.status, { error: allowed.error });
                return true;
            }
        }

        const client = {
            res,
            projectId: filterProjectId || null,
            claims
        };

        /* a project's stream starts from that project's conversation */
        const snap =
            filterProjectId
                ? projectSnapshot(filterProjectId, claims)
                : {
                    ...snapshotFor(claims),
                    events:
                        snapshot().events
                            .map(event => eventForClient(event, client))
                            .filter(Boolean)
                };

        sseHub.attach(
            req,
            res,
            client,
            {
                type: "snapshot",
                snapshot: snap
            }
        );

        return true;
    }

    /* ---------------------------------------------- state */

    if (
        pathname === "/api/state" &&
        req.method === "GET"
    ) {

        sendJson(res, 200, snapshotFor(claims));

        return true;
    }

    return false;
};
