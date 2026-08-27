/*
|--------------------------------------------------------------------------
| Console direction (EXECUTION_PLAN Phase 24 گام ۲)
|--------------------------------------------------------------------------
| RTL/LTR detection and where to apply it, so a Persian answer lays out
| right-to-left and a Rust snippet does not, without the operator choosing.
|--------------------------------------------------------------------------
*/

export const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export function containsRtlText(value) {
    return RTL_TEXT.test(String(value ?? ""));
}

export function applyBubbleDirection(box, content) {

    const rtl = containsRtlText(content);
    const direction = rtl ? "rtl" : "ltr";
    box.dir = direction;
    box.setAttribute("dir", direction);
    box.classList.add(direction);
}
