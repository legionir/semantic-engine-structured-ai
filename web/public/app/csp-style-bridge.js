/*
|--------------------------------------------------------------------------
| CSP style bridge
|--------------------------------------------------------------------------
|
| The console's Content-Security-Policy is `style-src 'self'`: no inline
| <style> elements and no style="" attributes. xterm.js computes part of
| its CSS at runtime (cell size, theme colours, cursor) and writes it into
| <style> elements, and paints true-colour cells with setAttribute("style").
| Both would be blocked, leaving a broken terminal.
|
| CSSOM is not subject to style-src, so the bridge routes the same CSS
| through it instead of relaxing the policy:
|   - document.createElement("style") returns an inert <csp-style>
|     element whose text is applied as a constructable stylesheet
|     (document.adoptedStyleSheets) while it is connected;
|   - setAttribute("style", text) on an element becomes style.cssText.
| Nothing in the console itself creates <style> elements or style
| attributes (CSP forbids it), so only xterm.js goes through this path.
| Markup parsed from HTML is unaffected: injected style="" in markup is
| still blocked by the policy.
|--------------------------------------------------------------------------
*/

let installed = false;


function supported(doc) {
    return Boolean(
        doc &&
        doc.defaultView &&
        doc.defaultView.customElements &&
        typeof doc.defaultView.CSSStyleSheet === "function" &&
        "adoptedStyleSheets" in doc
    );
}


export function installCspStyleBridge(doc = typeof document !== "undefined" ? document : null) {

    if (installed || !supported(doc)) return installed;

    const view = doc.defaultView;

    class CspStyle extends view.HTMLElement {

        constructor() {
            super();
            this.cssText = "";
            this.sheet = null;
        }

        connectedCallback() {
            this.hidden = true;
            this.apply();
        }

        disconnectedCallback() {
            if (!this.sheet) return;
            doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
        }

        /* xterm.js moves its screen element in and out of the document,
           so a reconnected element adopts its sheet again */
        apply() {
            if (!this.isConnected) return;
            if (!this.sheet) this.sheet = new view.CSSStyleSheet();
            if (!doc.adoptedStyleSheets.includes(this.sheet)) {
                doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, this.sheet];
            }
            try {
                this.sheet.replaceSync(this.cssText);
            } catch {
                /* invalid CSS is ignored, as a <style> element would */
            }
        }

        get textContent() {
            return this.cssText;
        }

        set textContent(value) {
            this.cssText = String(value ?? "");
            this.apply();
        }

        get innerText() {
            return this.cssText;
        }

        set innerText(value) {
            this.textContent = value;
        }
    }

    if (!view.customElements.get("csp-style")) view.customElements.define("csp-style", CspStyle);

    const createElement = doc.createElement;
    doc.createElement = function bridgedCreateElement(tagName, options) {
        return String(tagName).toLowerCase() === "style"
            ? createElement.call(this, "csp-style")
            : createElement.call(this, tagName, options);
    };

    const proto = view.Element.prototype;
    const setAttribute = proto.setAttribute;
    proto.setAttribute = function bridgedSetAttribute(name, value) {
        if (String(name).toLowerCase() === "style" && this.style) {
            this.style.cssText = String(value);
            return undefined;
        }
        return setAttribute.call(this, name, value);
    };

    installed = true;

    return installed;
}
