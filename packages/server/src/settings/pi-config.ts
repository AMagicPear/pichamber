import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiBehaviorSettings, PiProviderSettings } from "@amagicpear/pichamber-shared";

const providerSettings = (session: AgentSession): PiProviderSettings[] =>
  session.modelRuntime.getProviders().map((provider) => {
    const models = session.modelRuntime.getModels(provider.id);
    const auth = session.modelRuntime.getProviderAuthStatus(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      api: models[0]?.api,
      baseUrl: provider.baseUrl,
      modelCount: models.length,
      auth: {
        configured: auth.configured,
        supportsApiKey: Boolean(provider.auth.apiKey),
        canRemove: auth.source === "stored",
        source: auth.source,
        label: auth.label,
      },
    };
  });

export const listPiProviders = (session: AgentSession) => providerSettings(session);

const requireApiKeyProvider = (session: AgentSession, providerId: string) => {
  const provider = session.modelRuntime.getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (!provider.auth.apiKey) throw new Error(`${provider.name} does not support API-key authentication`);
  return provider;
};

export const setPiProviderApiKey = async (
  session: AgentSession,
  providerId: string,
  apiKey: string,
) => {
  requireApiKeyProvider(session, providerId);
  const interaction: AuthInteraction = {
    prompt: async () => apiKey,
    notify: () => {},
  };
  await session.modelRuntime.login(providerId, "api_key", interaction);
  return providerSettings(session);
};

export const removePiProviderCredential = async (session: AgentSession, providerId: string) => {
  requireApiKeyProvider(session, providerId);
  if (session.modelRuntime.getProviderAuthStatus(providerId).source !== "stored") {
    throw new Error("Only credentials stored by Pi can be removed here");
  }
  await session.modelRuntime.logout(providerId);
  return providerSettings(session);
};

export const getPiBehaviorSettings = (session: AgentSession): PiBehaviorSettings => {
  const settings = session.settingsManager;
  return {
    autoCompaction: settings.getCompactionEnabled(),
    autoRetry: settings.getRetryEnabled(),
    steeringMode: settings.getSteeringMode(),
    followUpMode: settings.getFollowUpMode(),
    transport: settings.getTransport(),
    httpIdleTimeoutMs: settings.getHttpIdleTimeoutMs(),
  };
};

export const updatePiBehaviorSettings = async (
  session: AgentSession,
  update: Partial<PiBehaviorSettings>,
) => {
  const settings = session.settingsManager;
  if (typeof update.autoCompaction === "boolean") settings.setCompactionEnabled(update.autoCompaction);
  if (typeof update.autoRetry === "boolean") settings.setRetryEnabled(update.autoRetry);
  if (update.steeringMode === "all" || update.steeringMode === "one-at-a-time") {
    settings.setSteeringMode(update.steeringMode);
  }
  if (update.followUpMode === "all" || update.followUpMode === "one-at-a-time") {
    settings.setFollowUpMode(update.followUpMode);
  }
  if (
    update.transport === "auto" ||
    update.transport === "sse" ||
    update.transport === "websocket" ||
    update.transport === "websocket-cached"
  ) {
    settings.setTransport(update.transport);
  }
  if (update.httpIdleTimeoutMs !== undefined) {
    if (!Number.isInteger(update.httpIdleTimeoutMs) || update.httpIdleTimeoutMs < 0) {
      throw new Error("HTTP idle timeout must be a non-negative integer");
    }
    settings.setHttpIdleTimeoutMs(update.httpIdleTimeoutMs);
  }
  await settings.flush();
  const errors = settings.drainErrors();
  if (errors.length > 0) throw new Error(errors.map((entry) => entry.error.message).join("\n"));
  return getPiBehaviorSettings(session);
};
