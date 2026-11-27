"use strict";

/*
|--------------------------------------------------------------------------
| Pictures from tools and the child environment (roadmap P3-01, P2-02)
|--------------------------------------------------------------------------
|
|   - MCP image items and image resource blobs are taken out of a tool
|     result, kept in the bounded store and shown to the model in one user
|     message; earlier pictures shrink to a note; session files never get
|     the bytes; the sizer counts a picture as IMAGE_CONTEXT_CHARS
|   - the codec keeps pictures under mcp_images instead of dropping them
|   - CHILD_ENV_PASSTHROUGH extends the inherited environment but never
|     lets a credential-looking name through
|--------------------------------------------------------------------------
*/

const assert = require("assert");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const settings = require(path.join(REPO, "agent", "config"));
const { ImageChannel, decodedBytes, isImageMessage, withoutImages, IMAGE_MESSAGE_MARKER } = require(path.join(REPO, "agent", "runtime", "ImageChannel"));
const codec = require(path.join(REPO, "agent", "mcp", "protocol", "JsonRpcCodec"));
const sizer = require(path.join(REPO, "agent", "context", "ConversationSizer"));
const childEnvironment = require(path.join(REPO, "agent", "tools", "process", "ChildEnvironment"));

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const results = [];


async function test(name, fn) {

    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ok   ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  FAIL ${name}`);
        console.log(`       ${error.stack}`);
    } finally {
        for (const key of ["MODEL_IMAGE_INPUT", "MODEL_IMAGE_MAX_BYTES", "IMAGE_CONTEXT_CHARS", "CHILD_ENV_PASSTHROUGH"]) settings.reset(key);
    }

}


async function main() {

    console.log("image channel and child environment");

    await test("decodedBytes reads the size behind base64", async () => {
        assert.equal(decodedBytes(PNG), Buffer.from(PNG, "base64").length);
        assert.equal(decodedBytes(""), 0);
    });

    await test("extract replaces MCP image items and image resource blobs with references", async () => {
        const channel = new ImageChannel();
        const out = channel.extract({
            text: "done",
            mcp_images: [
                { type: "image", data: PNG, mimeType: "image/png" },
                { type: "resource", resource: { uri: "file:///a.jpg", mimeType: "image/jpg", blob: PNG } }
            ]
        }, { source: "browser/screenshot" });
        assert.equal(out.text, "done");
        assert.match(out.mcp_images[0].image_ref, /^img_[0-9a-f]{12}$/);
        assert.equal(out.mcp_images[0].data, undefined);
        assert.equal(out.mcp_images[1].uri, "file:///a.jpg");
        assert.equal(out.mcp_images[1].image.media_type, "image/jpeg");
        assert.ok(!JSON.stringify(out).includes(PNG), "no base64 is left in the result");
        assert.equal(channel.refsIn(out).length, 2);
    });

    await test("unsupported types, oversized pictures and MODEL_IMAGE_INPUT=off are explained, not kept", async () => {
        const channel = new ImageChannel();
        assert.match(channel.keep({ mediaType: "image/svg+xml", data: PNG }).omitted, /unsupported/);
        settings.set("MODEL_IMAGE_MAX_BYTES", 1024);
        assert.match(channel.keep({ mediaType: "image/png", data: "A".repeat(4000) }).omitted, /MODEL_IMAGE_MAX_BYTES/);
        settings.reset("MODEL_IMAGE_MAX_BYTES");
        settings.set("MODEL_IMAGE_INPUT", "off");
        assert.match(channel.keep({ mediaType: "image/png", data: PNG }).omitted, /MODEL_IMAGE_INPUT=off/);
        assert.equal(channel.store.size, 0);
    });

    await test("the store is bounded and evicts the oldest picture", async () => {
        const channel = new ImageChannel({ capacity: 2 });
        const first = channel.keep({ mediaType: "image/png", data: PNG }).image_ref;
        channel.keep({ mediaType: "image/png", data: PNG });
        channel.keep({ mediaType: "image/png", data: PNG });
        assert.equal(channel.store.size, 2);
        assert.equal(channel.store.has(first), false);
        assert.deepEqual(channel.refsIn(`{"image_ref":"${first}"}`), [], "an evicted reference is not attached");
    });

    await test("appendFor adds one user message and reduces the previous one to a note", async () => {
        const channel = new ImageChannel();
        const messages = [{ role: "user", content: "task" }];
        const a = channel.extract({ type: "image", data: PNG, mimeType: "image/png" }, { source: "s/t" });
        assert.equal(channel.appendFor(messages, [{ ok: true, result: a }]), true);
        const added = messages.at(-1);
        assert.equal(added.role, "user");
        assert.ok(added.content[0].text.startsWith(IMAGE_MESSAGE_MARKER));
        assert.match(added.content[0].text, /s\/t/);
        assert.equal(added.content[1].image_url.url, `data:image/png;base64,${PNG}`);
        assert.equal(isImageMessage(added), true);
        assert.equal(isImageMessage(messages[0]), false);

        const b = channel.extract({ type: "image", data: PNG, mimeType: "image/png" });
        channel.appendFor(messages, JSON.stringify(b));
        assert.equal(typeof messages[1].content, "string");
        assert.match(messages[1].content, /no longer attached/);
        assert.equal(Array.isArray(messages[2].content), true);
        assert.equal(channel.appendFor(messages, { nothing: true }), false);

        settings.set("MODEL_IMAGE_INPUT", "off");
        assert.equal(channel.imageMessage(channel.refsIn(b)), null);
    });

    await test("session files get a note instead of picture bytes", async () => {
        const channel = new ImageChannel();
        const messages = [{ role: "user", content: "hi" }];
        channel.appendFor(messages, channel.extract({ type: "image", data: PNG, mimeType: "image/png" }));
        const stored = withoutImages(messages);
        assert.ok(!JSON.stringify(stored).includes(PNG));
        assert.match(stored[1].content, /not stored with the session/);
        assert.equal(Array.isArray(messages[1].content), true, "the live conversation keeps the picture");
        assert.equal(stored[0], messages[0]);
    });

    await test("the codec keeps pictures under mcp_images next to the text", async () => {
        const image = { type: "image", data: PNG, mimeType: "image/png" };
        const unpacked = codec.unpackToolResult({ content: [{ type: "text", text: "shot taken" }, image] });
        assert.equal(unpacked.text, "shot taken");
        assert.deepEqual(unpacked.mcp_images, [image]);
        const plain = codec.unpackToolResult({ content: [{ type: "text", text: "only text" }] });
        assert.equal(plain.mcp_images, undefined);
        const json = codec.unpackToolResult({ content: [{ type: "text", text: "[1,2]" }, image] });
        assert.deepEqual(json.result, [1, 2]);
        assert.equal(json.mcp_images.length, 1);
    });

    await test("the sizer counts a picture as IMAGE_CONTEXT_CHARS, not its base64 length", async () => {
        settings.set("IMAGE_CONTEXT_CHARS", 1234);
        const message = { role: "user", content: [{ type: "text", text: "abc" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(100000)}` } }] };
        assert.equal(sizer.partSize(message.content[1]), 1234);
        assert.equal(sizer.messageSize(message), JSON.stringify(message.content[0]).length + 1234);
    });

    await test("CHILD_ENV_PASSTHROUGH adds names; credential-looking names stay blocked", async () => {
        const source = { PATH: "/bin", MY_TOOL_HOME: "/opt/t", OTHER: "x", DEPLOY_TOKEN: "secret", OPENAI_API_KEY: "k" };
        assert.deepEqual(Object.keys(childEnvironment.build({}, source)), ["PATH"]);
        settings.set("CHILD_ENV_PASSTHROUGH", "my_tool_home, DEPLOY_TOKEN OPENAI_API_KEY");
        const env = childEnvironment.build({ GIT_TERMINAL_PROMPT: "0" }, source);
        assert.deepEqual(Object.keys(env).sort(), ["GIT_TERMINAL_PROMPT", "MY_TOOL_HOME", "PATH"]);
        assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    });

    const failed = results.filter(item => !item.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length === 0 ? 0 : 1);

}


main().catch(error => {
    console.error(error);
    process.exit(1);
});
