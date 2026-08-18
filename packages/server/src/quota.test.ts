import { describe, expect, test } from "bun:test";
import { listQuotaProvidersForModels } from "./quota";

describe("RPC quota providers", () => {
  test("lists only adapters with provider-id-only endpoint resolution", () => {
    expect(
      listQuotaProvidersForModels([
        { provider: "minimax-cn" },
        { provider: "deepseek" },
        { provider: "moonshotai-cn" },
        { provider: "openai" },
        { provider: "custom-openai-proxy" },
        { provider: "minimax-cn" },
      ]),
    ).toEqual([
      { id: "minimax-cn", name: "MiniMax" },
      { id: "deepseek", name: "DeepSeek" },
      { id: "moonshotai-cn", name: "Moonshot" },
      { id: "openai", name: "OpenAI" },
    ]);
  });
});
