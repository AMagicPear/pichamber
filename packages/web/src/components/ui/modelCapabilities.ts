import type { ModelDescriptor } from "@amagicpear/pichamber-shared";

/** A multimodal choice must be proven by Pi's model metadata. Unknown input
 * modalities fail closed, so an unverified model never appears in the image
 * picker. */
export const supportsImageInput = (model: ModelDescriptor | undefined): boolean =>
  model?.input?.includes("image") === true;

export const modelsForComposerInput = (
  models: ModelDescriptor[],
  needsImageInput: boolean,
): ModelDescriptor[] => needsImageInput ? models.filter(supportsImageInput) : models;

/** Hide an incompatible persisted selection while images are attached. The
 * server keeps the durable model until the user explicitly chooses a valid
 * replacement, while the send guard prevents the stale value being used. */
export const selectedModelForComposerInput = (
  model: ModelDescriptor | undefined,
  needsImageInput: boolean,
): ModelDescriptor | undefined => needsImageInput && !supportsImageInput(model) ? undefined : model;
