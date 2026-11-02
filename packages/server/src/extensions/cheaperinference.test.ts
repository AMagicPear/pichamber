import { describe, expect, test } from "bun:test";
import {
  fetchCheaperInferenceChatModels,
  isChatModel,
  toModelInput,
  toPiModel,
  toPiModelsFromCatalog,
  type CheaperInferenceCatalogEntry,
} from "../../../builtin-extensions/cheaperinference/index";

// ─── Fixtures (catalog categories) ─────────────────────────────────────
//
// The Cheaper Inference `/public/models` catalog mixes many categories. These
// fixtures mirror the catalog shapes on the live gateway: text-only chat,
// image-capable chat, a Responses-only text model, and single-purpose
// endpoints (embedding, image generation) that a coding agent must never
// surface as chat models.

const entry = (overrides: Partial<CheaperInferenceCatalogEntry>): CheaperInferenceCatalogEntry => ({
  id: "test-model",
  model_type: "text",
  endpoint: "/v1/chat/completions",
  supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
  ...overrides,
});

const textChat = entry({ id: "deepseek-v4-flash", supports_vision: false, supports_reasoning: true });
const imageChat = entry({ id: "gpt-5.4-mini", supports_vision: true, supports_reasoning: true });
const responsesOnly = entry({ id: "gpt-5.4-pro", endpoint: "/v1/responses", supported_endpoints: ["/v1/responses"] });
const embeddingOnly = entry({
  id: "text-embedding-3-small",
  model_type: "embedding",
  endpoint: "/v1/embeddings",
  supported_endpoints: ["/v1/embeddings"],
});
const imageGenOnly = entry({
  id: "flux-2-pro",
  model_type: "image",
  endpoint: "/v1/images/generations",
  supported_endpoints: ["/v1/images/generations"],
});

describe("Cheaper Inference catalog → Pi model mapping", () => {
  test("isChatModel keeps only text models served on chat completions", () => {
    expect(isChatModel(textChat)).toBe(true);
    expect(isChatModel(imageChat)).toBe(true);
    expect(isChatModel(responsesOnly)).toBe(false);
    expect(isChatModel(embeddingOnly)).toBe(false);
    expect(isChatModel(imageGenOnly)).toBe(false);
    // Falls back to the single `endpoint` field when the list is missing.
    expect(isChatModel(entry({ supported_endpoints: null }))).toBe(true);
  });

  test("toModelInput requires an explicit vision flag", () => {
    expect(toModelInput(textChat)).toEqual(["text"]);
    expect(toModelInput(imageChat)).toEqual(["text", "image"]);
    expect(toModelInput(entry({}))).toEqual(["text"]);
  });

  test("toPiModel preserves the bare model id and maps catalog metadata", () => {
    const model = toPiModel(
      entry({
        id: "gpt-5.4-mini",
        context_length: 400_000,
        max_output_tokens: 128_000,
        supports_vision: true,
        supports_reasoning: true,
        input_per_million: "0.5",
        output_per_million: "3",
        cache_read_per_million: "0.05",
        cache_write_per_million: "0.5",
      }),
    );
    expect(model.id).toBe("gpt-5.4-mini");
    expect(model.name).toBe("gpt-5.4-mini");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.contextWindow).toBe(400_000);
    expect(model.maxTokens).toBe(128_000);
    expect(model.cost).toEqual({ input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 });
  });

  test("toPiModel clamps maxTokens to contextWindow", () => {
    const model = toPiModel(entry({ context_length: 8_000, max_output_tokens: 128_000 }));
    expect(model.maxTokens).toBe(8_000);
  });

  test("toPiModel falls back to defaults when the catalog omits metadata", () => {
    const model = toPiModel(entry({ context_length: null, max_output_tokens: null }));
    expect(model.contextWindow).toBe(128_000);
    expect(model.maxTokens).toBe(32_768);
    expect(model.reasoning).toBe(false);
    expect(model.cost.input).toBe(0);
  });

  test("catalog conversion drops entries that are not chat models", () => {
    const models = toPiModelsFromCatalog([textChat, imageChat, responsesOnly, embeddingOnly, imageGenOnly]);
    expect(models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "gpt-5.4-mini"]);
  });
});

describe("Cheaper Inference catalog fetch", () => {
  test("requests the public catalog without credentials", async () => {
    let calledUrl: URL | undefined;
    let calledHeaders: Record<string, string> | undefined;
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = input instanceof URL ? input : new URL(String(input));
      calledHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ models: [textChat, imageChat, embeddingOnly] }), { status: 200 });
    };

    const models = await fetchCheaperInferenceChatModels(fakeFetch);

    expect(calledUrl?.toString()).toBe("https://api.cheaperinference.com/public/models");
    expect(calledHeaders?.Authorization).toBeUndefined();
    expect(models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "gpt-5.4-mini"]);
  });

  test("surfaces HTTP errors instead of inventing fallback models", async () => {
    const fakeFetch = async () => new Response("boom", { status: 500 });
    await expect(fetchCheaperInferenceChatModels(fakeFetch)).rejects.toThrow("HTTP 500");
  });

  test("surfaces a catalog without chat models instead of inventing fallback models", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ models: [embeddingOnly] }), { status: 200 });
    await expect(fetchCheaperInferenceChatModels(fakeFetch)).rejects.toThrow("empty chat model catalog");
  });

  test("propagates network failures", async () => {
    const fakeFetch = async () => {
      throw new Error("network down");
    };
    await expect(fetchCheaperInferenceChatModels(fakeFetch)).rejects.toThrow("network down");
  });
});
