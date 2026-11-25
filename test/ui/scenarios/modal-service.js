"use strict";

/*
| Console behaviour — the Modal service
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function ModalService({ test, Modal, backdrops }) {

    await test("a modal is a backdrop with a dialog inside it", () => {

        const handle =
            Modal.open({ title: "Settings", body: "content" });

        assert.equal(backdrops().length, 1);

        const dialog = backdrops()[0].children[0];

        assert.ok(dialog.classList.contains("modal"));
        assert.equal(dialog.getAttribute("role"), "dialog");
        assert.equal(dialog.getAttribute("aria-modal"), "true");

        assert.ok(document.body.classList.contains("modal-open"));

        handle.close();

        assert.equal(backdrops().length, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("the header and the footer are optional", () => {

        const bare =
            Modal.open({ body: "just a body", dismissible: false });

        const dialog = backdrops()[0].children[0];

        const [header, , footer] = dialog.children;

        assert.equal(header.hidden, true);
        assert.equal(footer.hidden, true);

        bare.close();

        const full =
            Modal.open({
                title: "Approval required",
                subtitle: "1/3 pending",
                body: "arguments",
                footer: Modal.button("Approve", "allow")
            });

        const second = backdrops()[0].children[0];

        assert.equal(second.children[0].hidden, false);
        assert.equal(second.children[2].hidden, false);

        assert.match(second.textContent, /Approval required/);
        assert.match(second.textContent, /1\/3 pending/);
        assert.match(second.textContent, /Approve/);

        full.close();
    });

    await test("footer buttons run their handler", () => {

        const clicks = [];

        const handle =
            Modal.open({
                title: "Approval",
                footer:
                    Modal.row(
                        Modal.button("Deny", "refuse", () => clicks.push("deny")),
                        Modal.button("Approve", "allow", () => clicks.push("allow")),
                        Modal.button("Approve all (3)", "ghost", () => clicks.push("all"))
                    )
            });

        const footer =
            backdrops()[0].children[0].children[2];

        const row = footer.children[0];

        assert.equal(row.children.length, 3);

        row.children[2].dispatch("click");
        row.children[0].dispatch("click");

        assert.deepEqual(clicks, ["all", "deny"]);

        handle.close();
    });

    await test("a click on the backdrop closes, a click inside does not", () => {

        let closed = null;

        const handle =
            Modal.open({
                title: "Detail",
                onClose: reason => {
                    closed = reason;
                }
            });

        const backdrop = backdrops()[0];
        const dialog = backdrop.children[0];

        backdrop.dispatch("mousedown", { target: dialog });

        assert.equal(backdrops().length, 1, "a click inside closed it");

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(backdrops().length, 0);
        assert.equal(closed, "backdrop");
        assert.equal(handle.isOpen(), false);
    });

    await test("escape closes the topmost modal only", () => {

        const first = Modal.open({ title: "first" });
        const second = Modal.open({ title: "second" });

        assert.equal(Modal.openCount, 2);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 1);
        assert.equal(second.isOpen(), false);
        assert.equal(first.isOpen(), true);

        document.dispatch("keydown", { key: "Escape" });

        assert.equal(Modal.openCount, 0);
        assert.equal(document.body.classList.contains("modal-open"), false);
    });

    await test("a modal that is not dismissible ignores escape and the backdrop", () => {

        const handle =
            Modal.open({ title: "busy", dismissible: false });

        document.dispatch("keydown", { key: "Escape" });

        const backdrop = backdrops()[0];

        backdrop.dispatch("mousedown", { target: backdrop });

        assert.equal(handle.isOpen(), true);

        handle.close("done");

        assert.equal(handle.isOpen(), false);
    });

    await test("title, subtitle, body and footer can be replaced in place", () => {

        const handle =
            Modal.open({ title: "one", body: "first" });

        handle.setTitle("two");
        handle.setSubtitle("2/5 pending");
        handle.setBody("second");
        handle.setFooter(Modal.button("Close", ""));

        const dialog = backdrops()[0].children[0];

        assert.match(dialog.textContent, /two/);
        assert.match(dialog.textContent, /2\/5 pending/);
        assert.match(dialog.textContent, /second/);
        assert.match(dialog.textContent, /Close/);
        assert.equal(/first/.test(dialog.textContent), false);

        handle.close();
    });

    await test("closing twice does not fire onClose twice", () => {

        let count = 0;

        const handle =
            Modal.open({
                title: "once",
                onClose: () => {
                    count++;
                }
            });

        handle.close();
        handle.close();

        assert.equal(count, 1);
        assert.equal(backdrops().length, 0);
    });

    await test("markup in data cannot break out of a label", () => {

        assert.equal(
            Modal.escape('<img src=x onerror="alert(1)">'),
            "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
        );
    });
};
