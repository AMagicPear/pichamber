import type { ModelDescriptor, ThinkingState } from "@amagicpear/pichamber-shared";
import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { providerName } from "../providers/providers";

/** Wrap a `Model` row in the slim wire descriptor (provider name + display name). */
const toDescriptor = (model: Model<any>, providerLabel: string): ModelDescriptor => ({
  provider: model.provider,
  providerName: providerLabel,
  id: model.id,
  name: model.name || model.id,
  reasoning: Boolean(model.reasoning),
});

const labelProvider = (session: AgentSession, providerId: string): string =>
  providerName(session, providerId) || providerId;

export const listAvailableModels = async (
  runtime: AgentSessionRuntime,
): Promise<ModelDescriptor[]> => {
  const models = runtime.session.modelRuntime.getAvailableSnapshot();
  return models.map((model) => toDescriptor(model, labelProvider(runtime.session, model.provider)));
};

/** Pick the current model out of the available set so the client always
 *  sees a descriptor whose `id` actually exists in `availableModels`. */
export const getEffectiveModelDescriptor = async (
  runtime: AgentSessionRuntime,
): Promise<{ model: ModelDescriptor | undefined; availableModels: ModelDescriptor[] }> => {
  const availableModels = await listAvailableModels(runtime);
  const current = runtime.session.model;
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
      providerName: labelProvider(runtime.session, current.provider),
      id: current.id,
      name: current.name,
      reasoning: Boolean(current.reasoning),
    },
    availableModels,
  };
};

export const getThinkingState = (runtime: AgentSessionRuntime): ThinkingState => ({
  level: runtime.session.thinkingLevel,
  availableLevels: runtime.session.getAvailableThinkingLevels(),
});
