import { describe, expect, test } from "bun:test";
import {
  declaresImageInput,
  fetchOrcaChatModels,
  toModelInput,
  toPiModel,
  toPiModelsFromCatalog,
  type OrcaModelCatalogEntry,
} from "../../../builtin-extensions/orcarouter/index";

// ─── Fixtures (catalog categories) ─────────────────────────────────────
//
// The OrcaRouter `/v1/models` catalog mixes many categories. These fixtures
// mirror the real catalog shapes observed on the live gateway: text-only chat,
// image-capable chat, and the single-purpose modality endpoints (embedding,
// image generation, video) that a coding-agent must never surface as chat
// models.

const entry = (overrides: Partial<OrcaModelCatalogEntry>): OrcaModelCatalogEntry => ({
  id: "test/model",
  architecture: { input_modalities: ["text"] },
  ...overrides,
});

const textChat = entry({ id: "deepseek/deepseek-v4-flash" });
const imageChat = entry({
  id: "anthropic/claude-sonnet-4-5",
  architecture: { input_modalities: ["text", "image"] },
});
const embeddingOnly = entry({ id: "openai/text-embedding-3-large" });
const imageGenOnly = entry({ id: "google/imagen-4.0-generate-001" });
const videoOnly = entry({ id: "kling/kling-v3" });
const ttsLike = entry({ id: "openai/tts-1" });

describe("OrcaRouter catalog → Pi model mapping", () => {
  test("declaresImageInput requires an explicit image modality", () => {
    expect(declaresImageInput(textChat)).toBe(false);
    expect(declaresImageInput(imageChat)).toBe(true);
    // Undeclared modality list fails closed (text-only), never widens.
    expect(declaresImageInput(entry({ architecture: null }))).toBe(false);
    expect(declaresImageInput(entry({ architecture: { input_modalities: ["file"] } }))).toBe(false);
  });

  test("toModelInput mirrors the image declaration", () => {
    expect(toModelInput(textChat)).toEqual(["text"]);
    expect(toModelInput(imageChat)).toEqual(["text", "image"]);
    expect(toModelInput(entry({ architecture: null }))).toEqual(["text"]);
  });

  test("toPiModel preserves the vendor/model id verbatim and fills conservative defaults", () => {
    const model = toPiModel(
      entry({
        id: "anthropic/claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        context_length: 1_000_000,
        max_completion_tokens: 64_000,
        pricing: { prompt_per_million: "3", completion_per_million: "15" },
      }),
    );
    expect(model.id).toBe("anthropic/claude-sonnet-4-5");
    expect(model.name).toBe("Claude Sonnet 4.5");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text"]);
    expect(model.contextWindow).toBe(1_000_000);
    expect(model.maxTokens).toBe(64_000);
    expect(model.cost.input).toBe(3);
    expect(model.cost.output).toBe(15);
    expect(model.cost.cacheRead).toBe(0);
    expect(model.cost.cacheWrite).toBe(0);
  });

  test("toPiModel clamps maxTokens to contextWindow", () => {
    const model = toPiModel(entry({ context_length: 8_000, max_completion_tokens: 128_000 }));
    expect(model.maxTokens).toBe(8_000);
  });

  test("toPiModel falls back to defaults when the catalog omits metadata", () => {
    const model = toPiModel(entry({ id: "orcarouter/free", context_length: undefined }));
    expect(model.contextWindow).toBe(128_000);
    expect(model.maxTokens).toBe(32_768);
    expect(model.cost.input).toBe(0);
  });

  test("catalog conversion keeps every entry (filtering is done by ?capability=chat)", () => {
    const all = [textChat, imageChat, embeddingOnly, imageGenOnly, videoOnly, ttsLike];
    const models = toPiModelsFromCatalog(all);
    expect(models).toHaveLength(all.length);
    expect(models.map((m) => m.id)).toEqual([
      "deepseek/deepseek-v4-flash",
      "anthropic/claude-sonnet-4-5",
      "openai/text-embedding-3-large",
      "google/imagen-4.0-generate-001",
      "kling/kling-v3",
      "openai/tts-1",
    ]);
  });
});

describe("OrcaRouter catalog fetch", () => {
  test("requests the authoritative ?capability=chat list with the Bearer key", async () => {
    let calledUrl: URL | undefined;
    let calledHeaders: Record<string, string> | undefined;
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = input instanceof URL ? input : new URL(String(input));
      calledHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [textChat, imageChat] }), { status: 200 });
    };

    const models = await fetchOrcaChatModels("sk-test", fakeFetch);

    expect(calledUrl?.toString()).toBe("https://api.orcarouter.ai/v1/models?capability=chat");
    expect(calledHeaders?.Authorization).toBe("Bearer sk-test");
    expect(models.map((m) => m.id)).toEqual([
      "deepseek/deepseek-v4-flash",
      "anthropic/claude-sonnet-4-5",
    ]);
    // Image-capable entries keep their declared input.
    expect(models.find((m) => m.id === "anthropic/claude-sonnet-4-5")?.input).toEqual(["text", "image"]);
  });

  test("omits the Authorization header when no key is configured", async () => {
    let calledHeaders: Record<string, string> | undefined;
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      calledHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [textChat] }), { status: 200 });
    };
    await fetchOrcaChatModels(undefined, fakeFetch);
    expect(calledHeaders?.Authorization).toBeUndefined();
  });

  test("surfaces HTTP errors instead of inventing fallback models", async () => {
    const fakeFetch = async () => new Response("boom", { status: 500 });
    await expect(fetchOrcaChatModels("sk-test", fakeFetch)).rejects.toThrow("HTTP 500");
  });

  test("surfaces an empty catalog instead of inventing fallback models", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    await expect(fetchOrcaChatModels("sk-test", fakeFetch)).rejects.toThrow("empty chat model catalog");
  });

  test("propagates network failures", async () => {
    const fakeFetch = async () => {
      throw new Error("network down");
    };
    await expect(fetchOrcaChatModels("sk-test", fakeFetch)).rejects.toThrow("network down");
  });
});
