import type { ModelDescriptor } from "@pichamber/shared";

/** Use the registry's friendly name everywhere a model id is displayed. */
export const modelDisplayName = (
  models: ModelDescriptor[] | undefined,
  provider: unknown,
  modelId: unknown,
): string | undefined => {
  if (typeof modelId !== "string") return undefined;
  return models?.find((model) => model.provider === provider && model.id === modelId)?.name ?? modelId;
};
