import type { ModelDescriptor, ThinkingState } from "@pichamber/shared";
import type { RuntimeModelInfo, SessionRuntime, RuntimeModelDescriptor } from "./runtime";

/** Wrap the runtime's `ModelInfo` rows in the slim wire descriptor
 *  (provider name + display name). */
const toDescriptor = (model: RuntimeModelInfo, providerLabel: string): ModelDescriptor => ({
  provider: model.provider,
  providerName: providerLabel,
  id: model.id,
  name: model.name || model.id,
  reasoning: model.reasoning,
});

const labelProvider = (runtime: SessionRuntime, providerId: string): string =>
  runtime.getProviderName(providerId) || providerId;

export const listAvailableModels = async (
  runtime: SessionRuntime,
): Promise<ModelDescriptor[]> => {
  const models = await runtime.getAvailableModels();
  return models.map((model) => toDescriptor(model, labelProvider(runtime, model.provider)));
};

/** Pick the current model out of the available set so the client always
 *  sees a descriptor whose `id` actually exists in `availableModels`. */
export const getEffectiveModelDescriptor = async (
  runtime: SessionRuntime,
): Promise<{ model: ModelDescriptor | undefined; availableModels: ModelDescriptor[] }> => {
  const availableModels = await listAvailableModels(runtime);
  const current: RuntimeModelDescriptor | undefined = runtime.getCurrentModel();
  if (!current) return { model: undefined, availableModels };
  const matchIndex = availableModels.findIndex(
    (m) => m.provider === current.provider && m.id === current.id,
  );
  if (matchIndex !== -1 && current.name) {
    availableModels[matchIndex] = { ...availableModels[matchIndex]!, name: current.name };
  }
  const match = matchIndex === -1 ? undefined : availableModels[matchIndex];
  return {
    model: match ?? {
      provider: current.provider,
      providerName: current.providerName || labelProvider(runtime, current.provider),
      id: current.id,
      name: current.name,
      reasoning: current.reasoning,
    },
    availableModels,
  };
};

/** Read the runtime's mirrored thinking state. */
export const getThinkingState = (runtime: SessionRuntime): ThinkingState => ({
  level: runtime.thinkingLevel,
  availableLevels: runtime.getAvailableThinkingLevels(),
});
