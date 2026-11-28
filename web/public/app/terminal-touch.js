/*
|--------------------------------------------------------------------------
| Terminal touch scrolling
|--------------------------------------------------------------------------
|
| xterm.js does not scroll its history with a finger drag; this turns a
| vertical drag on the screen into whole scrolled lines. A drag on the
| scrollbar itself is left to the scrollbar. Returns the uninstaller.
|--------------------------------------------------------------------------
*/


export function installTouchScroll(element, term) {

    if (typeof term.scrollLines !== "function") return () => {};

    let tracking = false;
    let scrolling = false;
    let startY = 0;
    let lastY = 0;
    let carry = 0;

    const lineHeight = () => {
        const rows = Math.max(1, Number(term.rows) || 24);
        const height = element.clientHeight || (element.getBoundingClientRect ? element.getBoundingClientRect().height : 0);
        return Math.max(12, height > 0 ? height / rows : 18);
    };

    const onStart = event => {
        if (!event.touches || event.touches.length !== 1) {
            tracking = false;
            scrolling = false;
            return;
        }
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".scrollbar")) {
            tracking = false;
            return;
        }
        tracking = true;
        scrolling = false;
        startY = event.touches[0].clientY;
        lastY = startY;
        carry = 0;
    };

    const onMove = event => {
        if (!tracking || !event.touches || event.touches.length !== 1) return;
        const y = event.touches[0].clientY;
        if (!scrolling && Math.abs(y - startY) < 4) return;
        scrolling = true;
        if (event.cancelable) event.preventDefault();
        const deltaY = y - lastY;
        lastY = y;
        carry += deltaY;
        const step = lineHeight();
        const lines = Math.trunc(carry / step);
        if (lines !== 0) {
            carry -= lines * step;
            term.scrollLines(-lines);
        }
    };

    const onEnd = () => {
        tracking = false;
        scrolling = false;
        carry = 0;
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd, { passive: true });
    element.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onEnd);
    };
}
