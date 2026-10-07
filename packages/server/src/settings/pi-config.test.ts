import { expect, test } from "bun:test";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { AgentSession, RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";
import { createUiBridge } from "../extensions/extension-ui";
import { loginPiProvider, removePiProviderCredential } from "./pi-config";

test("OAuth uses browser dialogs, keeps credentials out of responses, and permits OAuth logout", async () => {
  const requests: RpcExtensionUIRequest[] = [];
  const bridge = createUiBridge((request) => {
    requests.push(request);
    if (request.method === "input") bridge.handleResponse({ type: "extension_ui_response", id: request.id, value: "authorization-code" });
  });
  const provider = { id: "mock", name: "Mock", auth: { oauth: { name: "Sign in" } } };
  let loggedOut = false;
  const session = {
    extensionRunner: { hasUI: () => true, getUIContext: () => bridge.context },
    modelRuntime: {
      getProvider: () => provider,
      getProviders: () => [provider],
      getModels: () => [],
      getProviderAuthStatus: () => ({ configured: true, source: "stored", label: "OAuth" }),
      login: async (_provider: string, type: string, interaction: AuthInteraction) => {
        expect(type).toBe("oauth");
        interaction.notify({ type: "auth_url", url: "https://example.invalid/login" });
        expect(await interaction.prompt({ type: "manual_code", message: "Paste code" })).toBe("authorization-code");
        return { type: "oauth", access: "private-token", refresh: "private-refresh", expires: 1 };
      },
      logout: async () => { loggedOut = true; },
    },
  } as unknown as AgentSession;
  const result = await loginPiProvider(session, "mock", new AbortController().signal);
  expect(result[0]?.auth).toMatchObject({ oauthLabel: "Sign in", supportsApiKey: false, canRemove: true });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(requests.some((request) => request.method === "notify" && request.message.includes("https://example.invalid/login"))).toBe(true);
  await removePiProviderCredential(session, "mock");
  expect(loggedOut).toBe(true);
  bridge.context.input = async () => undefined;
  await expect(loginPiProvider(session, "mock", new AbortController().signal)).rejects.toThrow("Sign-in cancelled");
  session.modelRuntime.login = async (_provider, _type, interaction) => {
    const completedCallback = new AbortController();
    completedCallback.abort();
    await expect(interaction.prompt({ type: "manual_code", message: "Paste code", signal: completedCallback.signal })).rejects.toThrow("Sign-in prompt closed");
    expect(interaction.signal?.aborted).toBe(false);
    return { type: "oauth", access: "private-token", refresh: "private-refresh", expires: 1 };
  };
  await loginPiProvider(session, "mock", new AbortController().signal);
});
