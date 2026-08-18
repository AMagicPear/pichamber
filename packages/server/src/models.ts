import type { ModelInfo } from "@earendil-works/pi-coding-agent";
import type { ModelDescriptor, ThinkingState } from "@pichamber/shared";
import type { SessionRuntime, RuntimeModelDescriptor } from "./runtime";
import { providerName } from "./providers";

/** Wrap the runtime's `ModelInfo` rows in the slim wire descriptor
 *  (provider name + display name). */
const toDescriptor = (model: ModelInfo, providerLabel: string): ModelDescriptor => ({
  provider: model.provider,
  providerName: providerLabel,
  id: model.id,
  // ModelInfo doesn't carry a display name. The runtime's current-model
  // descriptor carries one (when available) and we layer it on top in
  // `getEffectiveModelDescriptor` below.
  name: model.id,
  reasoning: model.reasoning,
});

/** Resolve a human-friendly provider label. SDK runtimes carry the full
 *  registry so we use Pi's display names; RPC runtimes fall back to
 *  whatever the runtime mirrored (typically the id). */
const labelProvider = (runtime: SessionRuntime, providerId: string): string => {
  if (runtime.type === "sdk" && runtime.agentSession) {
    return providerName(runtime.agentSession, providerId);
  }
  return runtime.getProviderName(providerId) || providerId;
};

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
  const match = availableModels.find(
    (m) => m.provider === current.provider && m.id === current.id,
  );
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