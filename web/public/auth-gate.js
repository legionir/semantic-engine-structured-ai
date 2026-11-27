"use strict";

(async function startConsole() {
    const root = document.documentElement;
    const login = document.getElementById("consoleLogin");
    const form = document.getElementById("consoleLoginForm");
    const password = document.getElementById("consolePassword");
    const error = document.getElementById("consoleLoginError");
    const button = document.getElementById("consoleLoginButton");
    const heading = login?.querySelector("h1");
    const description = login?.querySelector("p");
    const label = login?.querySelector("label");
    let mode = "password";

    const enterConsole = () => import("/app/main.js");

    function readQueryToken() {
        try {
            if (typeof URLSearchParams !== "function" || !window?.location?.search) return null;
            const params = new URLSearchParams(window.location.search);
            const value = params.get("token");
            if (!value) return null;
            if (window.history && typeof window.history.replaceState === "function") {
                params.delete("token");
                const rest = params.toString();
                const cleanUrl = `${window.location.pathname || "/"}${rest ? `?${rest}` : ""}${window.location.hash || ""}`;
                window.history.replaceState(null, "", cleanUrl);
            }
            return value.trim() || null;
        } catch {
            return null;
        }
    }

    function showConsoleBody() {
        if (login) login.hidden = true;
        const header = document.querySelector("header");
        const main = document.getElementById("consoleMain");
        const bar = document.getElementById("projectBar");
        if (header) header.hidden = false;
        if (main) main.hidden = false;
        if (bar) bar.hidden = false;
    }

    function showLogin(message = "", tokenMode = false) {
        mode = tokenMode ? "token" : "password";
        if (heading) heading.textContent = tokenMode ? "Console token" : "Sign in";
        if (description) {
            description.textContent = tokenMode
                ? "Enter the console access token to continue."
                : "Enter the web console password to continue.";
        }
        if (label) label.textContent = tokenMode ? "Access token" : "Password";
        if (password) {
            password.placeholder = tokenMode ? "Paste console token" : "";
            password.autocomplete = tokenMode ? "off" : "current-password";
        }
        if (button) button.textContent = tokenMode ? "Unlock" : "Continue";
        const header = document.querySelector("header");
        const main = document.getElementById("consoleMain");
        const bar = document.getElementById("projectBar");
        const dashboard = document.getElementById("projectDashboard");
        if (header) header.hidden = true;
        if (main) main.hidden = true;
        if (bar) bar.hidden = true;
        if (dashboard) dashboard.hidden = true;
        if (login) login.hidden = false;
        if (error) {
            error.textContent = message;
            error.hidden = !message;
        }
        password?.focus?.();
    }

    async function checkCookiePersisted() {
        try {
            const recheck = await fetch("/auth/status", { cache: "no-store", credentials: "same-origin" });
            if (!recheck.ok) return false;
            const state = await recheck.json();
            return state.authenticated === true;
        } catch {
            return false;
        }
    }

    async function submitToken(candidate) {
        const loginResponse = await fetch("/auth/login", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: candidate })
        });
        if (!loginResponse.ok) {
            const result = await loginResponse.json().catch(() => ({}));
            throw new Error(result.error || "Sign-in failed.");
        }
        if (await checkCookiePersisted()) {
            window.location.reload();
            return true;
        }
        window.__structuredAiConsoleToken = candidate;
        showConsoleBody();
        await enterConsole();
        return true;
    }

    try {
        const queryToken = readQueryToken();
        const response = await fetch("/auth/status", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not check console authentication.");
        const auth = await response.json();
        root.classList.remove("auth-pending");

        if (!auth.passwordRequired && auth.authenticated === false && queryToken) {
            try {
                await submitToken(queryToken);
                return;
            } catch (tokenError) {
                showLogin(tokenError.message, true);
            }
        }

        if (auth.authenticated === false || (auth.passwordRequired && !auth.authenticated)) {
            const tokenMode = !auth.passwordRequired;
            showLogin(error && !error.hidden ? error.textContent : "", tokenMode);
            form?.addEventListener("submit", async event => {
                event.preventDefault();
                if (button) button.disabled = true;
                if (error) error.hidden = true;
                const submitted = password ? password.value : "";
                try {
                    if (mode === "token") {
                        const trimmed = submitted.trim();
                        if (!trimmed) throw new Error("Enter the console token.");
                        if (password) password.value = "";
                        await submitToken(trimmed);
                    } else {
                        const loginResponse = await fetch("/auth/login", {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ password: submitted })
                        });
                        const result = await loginResponse.json().catch(() => ({}));
                        if (!loginResponse.ok) {
                            throw new Error(result.error || "Sign-in failed.");
                        }
                        if (password) password.value = "";
                        if ((await checkCookiePersisted()) || !result?.sessionToken) {
                            window.location.reload();
                            return;
                        }
                        window.__structuredAiConsoleSession = result.sessionToken;
                        showConsoleBody();
                        await enterConsole();
                    }
                } catch (loginError) {
                    if (password) password.value = "";
                    showLogin(loginError.message, mode === "token");
                } finally {
                    if (button) button.disabled = false;
                }
            });
            return;
        }

        await enterConsole();
    } catch (startError) {
        root.classList.remove("auth-pending");
        showLogin(startError.message || "Console startup failed. Refresh to try again.");
    }
})();
