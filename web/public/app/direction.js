/* RTL/LTR detection for message text (Persian, Arabic, Hebrew). */

const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;


export function containsRtlText(value) {
    return RTL_TEXT.test(String(value ?? ""));
}


export function directionOf(value) {
    return containsRtlText(value) ? "rtl" : "ltr";
}
