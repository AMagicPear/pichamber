import { describe, expect, test } from "bun:test";
import type { RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";
import { createUiBridge, WEB_EXTENSION_HOST_MODE } from "./extension-ui";

describe("extension UI bridge", () => {
  test("declares the browser as Pi's RPC-compatible extension UI host", () => {
    expect(WEB_EXTENSION_HOST_MODE).toBe("rpc");
  });

  test("resolves browser dialog responses", async () => {
    const requests: RpcExtensionUIRequest[] = [];
    const bridge = createUiBridge((request) => requests.push(request));
    const pending = bridge.context.confirm("Allow?", "Run the tool?");
    const request = requests[0];
    expect(request?.method).toBe("confirm");
    bridge.handleResponse({
      type: "extension_ui_response",
      id: request!.id,
      confirmed: true,
    });
    expect(await pending).toBe(true);
  });

  test("cancels pending dialogs when a channel closes", async () => {
    const requests: RpcExtensionUIRequest[] = [];
    const bridge = createUiBridge((request) => requests.push(request));
    const pending = bridge.context.select("Choose", ["one", "two"]);
    expect(requests).toHaveLength(1);
    bridge.cancelPending();
    expect(await pending).toBeUndefined();
  });
});
