import { describe, expect, test } from "bun:test";
import type { ModelDescriptor } from "@amagicpear/pichamber-shared";
import {
  modelsForComposerInput,
  selectedModelForComposerInput,
  supportsImageInput,
} from "./modelCapabilities";

const model = (id: string, input?: Array<"text" | "image">): ModelDescriptor => ({
  provider: "orcarouter",
  providerName: "OrcaRouter",
  id,
  name: id,
  reasoning: false,
  input,
});

const textOnly = model("vendor/text", ["text"]);
const multimodal = model("vendor/vision", ["text", "image"]);
const unknown = model("vendor/unknown");

describe("composer model capability filtering", () => {
  test("keeps the complete API-backed catalog for text prompts", () => {
    expect(modelsForComposerInput([textOnly, multimodal, unknown], false)).toEqual([
      textOnly,
      multimodal,
      unknown,
    ]);
  });

  test("shows only explicitly image-capable models when an image is attached", () => {
    expect(modelsForComposerInput([textOnly, multimodal, unknown], true)).toEqual([multimodal]);
    expect(supportsImageInput(unknown)).toBe(false);
  });

  test("invalidates text-only and unknown persisted selections for image input", () => {
    expect(selectedModelForComposerInput(textOnly, true)).toBeUndefined();
    expect(selectedModelForComposerInput(unknown, true)).toBeUndefined();
    expect(selectedModelForComposerInput(multimodal, true)).toBe(multimodal);
    expect(selectedModelForComposerInput(textOnly, false)).toBe(textOnly);
  });
});
