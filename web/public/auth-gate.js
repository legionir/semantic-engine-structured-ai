"use strict";

(async function startConsole() {
    const root = document.documentElement;
    const login = document.getElementById("consoleLogin");
    const form = document.getElementById("consoleLoginForm");
    const password = document.getElementById("consolePassword");
    const error = document.getElementById("consoleLoginError");
    const button = document.getElementById("consoleLoginButton");

    function showLogin(message = "") {
        document.querySelector("header").hidden = true;
        document.getElementById("consoleMain").hidden = true;
        document.getElementById("projectDashboard").hidden = true;
        login.hidden = false;
        error.textContent = message;
        error.hidden = !message;
        password.focus();
    }

    try {
        const response = await fetch("/auth/status", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not check console authentication.");
        const auth = await response.json();
        root.classList.remove("auth-pending");

        if (auth.passwordRequired && !auth.authenticated) {
            showLogin();
            form.addEventListener("submit", async event => {
                event.preventDefault();
                button.disabled = true;
                error.hidden = true;
                try {
                    const loginResponse = await fetch("/auth/login", {
                        method: "POST",
                        credentials: "same-origin",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ password: password.value })
                    });
                    if (!loginResponse.ok) {
                        const result = await loginResponse.json().catch(() => ({}));
                        throw new Error(result.error || "Sign-in failed.");
                    }
                    window.location.reload();
                } catch (loginError) {
                    password.value = "";
                    showLogin(loginError.message);
                } finally {
                    button.disabled = false;
                }
            });
            return;
        }

        await import("/app/main.js");
    } catch (startError) {
        root.classList.remove("auth-pending");
        showLogin(startError.message || "Console startup failed. Refresh to try again.");
    }
})();
