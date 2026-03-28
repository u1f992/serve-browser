import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serveBrowser, type ServedBrowser } from "../src/index.ts";

describe("serveBrowser", () => {
  it("launches chrome and returns a wsEndpoint", async () => {
    let server: ServedBrowser | undefined;
    try {
      server = await serveBrowser({
        browser: "chrome",
        tag: "stable",
        args: ["--headless", "--no-sandbox"],
      });
      assert.ok(server.wsEndpoint.startsWith("ws://"));
    } finally {
      await server?.[Symbol.asyncDispose]();
    }
  });

  it("disposes the browser process", async () => {
    const server = await serveBrowser({
      browser: "chrome",
      tag: "stable",
      args: ["--headless", "--no-sandbox"],
    });
    assert.ok(server.wsEndpoint.startsWith("ws://"));
    await server[Symbol.asyncDispose]();

    // After dispose, the WebSocket endpoint should no longer be reachable
    const url = server.wsEndpoint.replace("ws://", "http://");
    await assert.rejects(
      fetch(url),
      (err: unknown) => err instanceof TypeError,
    );
  });
});
