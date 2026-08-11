import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelDescriptor, ThinkingState } from "@pichamber/shared";

/** ModelRuntime 暴露的模型类型（getAvailable 返回 Model<Api>[]）。 */
type AvailableModel = Model<Api>;

/** Wait until the runtime has finished refreshing availability, so callers
 *  (e.g. ws `ready` and post-`set_model` broadcasts) see the full set of
 *  models whose providers have auth configured. The runtime coalesces
 *  concurrent refreshes; awaiting it once is enough for the call site. */
const awaitAvailabilityRefresh = async (session: AgentSession): Promise<readonly AvailableModel[]> => {
  const runtime = session.modelRuntime;
  const cached = runtime.getAvailableSnapshot();
  if (cached.length > 0) return cached;
  try {
    return await runtime.getAvailable();
  } catch {
    return runtime.getAvailableSnapshot();
  }
};

const toDescriptor = (model: AvailableModel): ModelDescriptor => ({
  provider: model.provider,
  id: model.id,
  name: model.name || model.id,
  reasoning: Boolean(model.reasoning),
});

/** Returns every model whose provider has auth configured. The runtime
 *  filters out unconfigured providers internally — no need to filter
 *  again here. */
export const listAvailableModels = async (session: AgentSession): Promise<ModelDescriptor[]> => {
  const models = await awaitAvailabilityRefresh(session);
  return models.map(toDescriptor);
};

/** Pick the current model out of the available set so the client always
 *  sees a descriptor whose `id` actually exists in `availableModels`. If
 *  auth is missing for the active model, the existing descriptor is kept
 *  so the UI can still show what's loaded. */
export const getEffectiveModelDescriptor = async (
  session: AgentSession,
): Promise<{ model: ModelDescriptor | undefined; availableModels: ModelDescriptor[] }> => {
  const availableModels = await listAvailableModels(session);
  const current = session.model;
  if (!current) return { model: undefined, availableModels };
  const match = availableModels.find((m) => m.provider === current.provider && m.id === current.id);
  return { model: match ?? toDescriptor(current), availableModels };
};

export const getThinkingState = (session: AgentSession): ThinkingState => ({
  level: session.thinkingLevel,
  availableLevels: session.getAvailableThinkingLevels(),
});
