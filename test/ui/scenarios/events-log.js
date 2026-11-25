"use strict";

/*
| Console behaviour — the events modal: filter, type and round trips
|
| Runs inside ui.test.js, in order, against the console it booted:
| a test here may rely on what an earlier group left on the page.
*/

const assert = require("assert");


module.exports = async function EventsLog({ test, Modal, backdrops, card, console_ }) {

    /*
    | The Execution and Events modals used to borrow the page's own nodes,
    | and every bug in giving them back left the console dead (a stranded
    | #log made every later event throw). They now have no page copy at
    | all: each opening draws from the store, and what the operator set in
    | one opening (the filter, the type) is there in the next.
    */

    await test("execution and events exist only as modals and keep their settings between openings", () => {

        for (const id of ["rowTwo", "log", "logFilter", "logType", "logCount", "clearLog", "tree", "executionArchive", "execSummary"]) {
            assert.equal(document.getElementById(id), null, `#${id} has no page copy`);
        }
        assert.equal(document.querySelectorAll(".tree, ul.log").length, 0, "nothing is drawn while both are closed");

        const rows = card.log();
        const before = rows.children.length;
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 41 });
        assert.equal(rows.children.length, before + 1, "an event reaches the open modal");
        assert.match(rows.lastElementChild.textContent, /41/);

        card.filter().value = "iteration";
        card.filter().dispatch("input");
        const hidden = [...card.log().children].map(item => item.hidden);
        assert.ok(hidden.includes(true), "the filter hides rows");
        card.close();

        assert.equal(card.filter().value, "iteration", "the next opening shows the same filter");
        assert.deepEqual([...card.log().children].map(item => item.hidden), hidden, "and hides the same rows");
        card.filter().value = "";
        card.filter().dispatch("input");
        card.close();

        const tools = card.tree().querySelectorAll("button.tool").length;
        card.close();
        assert.equal(card.tree().querySelectorAll("button.tool").length, tools, "the tree is drawn the same each time");
        card.close();

        for (const button of ["eventsButton", "executionButton", "eventsButton", "executionButton"]) {
            document.getElementById(button).dispatch("click");
            Modal.closeTop("test");
        }

        assert.equal(backdrops().length, 0);
        assert.equal(document.querySelectorAll(".tree, ul.log").length, 0, "closing leaves nothing behind");
    });

    await test("the event stream keeps drawing after a modal round trip", () => {

        const before =
            card.log().children.length;

        document.getElementById("eventsButton").dispatch("click");
        Modal.closeTop("test");

        console_.send({
            type: "agent_start",
            agent: "main_agent",
            depth: 0
        });

        const list =
            card.log();

        assert.ok(list, "the list survived the round trip");

        assert.ok(
            list.children.length > before,
            "the event after the round trip was drawn"
        );
    });

    await test("the events filter matches any part of a word, in the type or the text", () => {

        const list =
            card.log();

        const filter =
            card.filter();

        list.innerHTML = "";

        card.clear().dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:end", agent: "main_agent", name: "terminal_exec", success: true, duration_ms: 12 },
                { type: "agent:iteration", agent: "researcher", iteration: 2 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            [...list.children].filter(item => !item.hidden);

        assert.equal(visible().length, 3, "every row shows with no filter");

        /* a fragment from the middle of a word, not a prefix */

        filter.value = "rmina";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a fragment inside a word matches the row that contains it"
        );

        assert.match(visible()[0].textContent, /terminal_exec/);

        /* the event type is searched too, not only the description */

        filter.value = "iterat";

        filter.dispatch("input");

        assert.equal(visible().length, 1);
        assert.equal(visible()[0].dataset.type, "agent:iteration");

        /* and matching is case insensitive */

        filter.value = "FS_READ";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "an upper case query matches a lower case row"
        );

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 3, "clearing the box restores every row");
    });

    await test("the events filter narrows to one type, and combines with the text", () => {

        const list =
            card.log();

        const filter =
            card.filter();

        const type =
            card.type();

        list.innerHTML = "";

        card.clear().dispatch("click");

        for (
            const event
            of [
                { type: "tool:start", agent: "main_agent", name: "fs_read" },
                { type: "tool:start", agent: "main_agent", name: "fs_write" },
                { type: "tool:end", agent: "main_agent", name: "fs_read", success: true, duration_ms: 8 }
            ]
        ) {
            console_.send(event);
        }

        const visible = () =>
            [...list.children].filter(item => !item.hidden);

        /* the dropdown offers exactly the types that are present */

        assert.deepEqual(
            [...type.children]
                .map(option => option.value)
                .filter(Boolean)
                .sort(),
            ["tool:end", "tool:start"],
            "the type list is built from the events that arrived"
        );

        type.value = "tool:start";

        type.dispatch("change");

        assert.equal(visible().length, 2, "only the chosen type is shown");

        for (const item of visible()) {
            assert.equal(item.dataset.type, "tool:start");
        }

        /* the two filters are an intersection, not a replacement */

        filter.value = "write";

        filter.dispatch("input");

        assert.equal(
            visible().length,
            1,
            "a row must pass the type filter and the text filter"
        );

        assert.match(visible()[0].textContent, /fs_write/);

        /* the count reports what survived, out of what there is */

        assert.equal(
            card.count().textContent,
            "1 of 3"
        );

        /* a row arriving while a filter is on obeys it too */

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_delete"
        });

        assert.equal(
            visible().length,
            1,
            "a new row that does not match stays hidden"
        );

        console_.send({
            type: "tool:start",
            agent: "main_agent",
            name: "fs_write_many"
        });

        assert.equal(
            visible().length,
            2,
            "a new row that matches both filters is shown"
        );

        type.value = "";

        type.dispatch("change");

        filter.value = "";

        filter.dispatch("input");

        assert.equal(visible().length, 5, "clearing both filters shows everything");

        assert.equal(
            card.count().textContent,
            "5 events"
        );
    });

    await test("the events filter survives the modal round trip", () => {

        const list =
            card.log();

        list.innerHTML = "";

        card.clear().dispatch("click");

        console_.send({ type: "tool:start", agent: "main_agent", name: "fs_read" });
        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 1 });

        card.type().value = "tool:start";

        card.type().dispatch("change");

        /*
        | The controls move into the modal with the list, so the filter
        | has to keep working there, and keep working again afterwards.
        */

        document.getElementById("eventsButton").dispatch("click");

        assert.equal(
            card.type().value,
            "tool:start",
            "the chosen type came along into the modal"
        );

        console_.send({ type: "agent:iteration", agent: "main_agent", iteration: 2 });

        assert.equal(
            [...card.log()
                .children].filter(item => !item.hidden).length,
            1,
            "the filter still applies to rows arriving while the modal is open"
        );

        Modal.closeTop("test");

        card.type().value = "";

        card.type().dispatch("change");

        assert.equal(
            [...card.log()
                .children].filter(item => !item.hidden).length,
            3,
            "the filter still works after the controls went home"
        );
    });

    await test("a modal title given as a getter is read, not stringified", () => {

        const handle =
            Modal.open({
                title: () => "computed",
                subtitle: () => "later",
                body: "x"
            });

        const text =
            handle.element.textContent;

        assert.match(text, /computed/);
        assert.match(text, /later/);

        assert.ok(
            !text.includes("=>"),
            "the getter itself must not reach the header"
        );

        handle.close("test");
    });

};
