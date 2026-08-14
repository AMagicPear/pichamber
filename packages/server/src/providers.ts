import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Thin, single-source wrapper over Pi's provider registry. Every consumer
 *  (model descriptors, context stats, quota adapters) reads provider
 *  metadata through here instead of reaching into `modelRuntime` itself —
 *  one place to change if Pi's SDK surface shifts. */

/** Human-readable provider name from Pi's registry; falls back to the id. */
export const providerName = (session: AgentSession, providerId: string): string =>
  session.modelRuntime.getProvider(providerId)?.name ?? providerId;

/** The model `api` type a provider speaks (e.g. "openai-completions").
 *  Used by quota adapters to match generic providers by protocol. */
export const providerApiType = (session: AgentSession, providerId: string): string | undefined =>
  session.modelRuntime.getProvider(providerId)?.getModels()[0]?.api as string | undefined;

/** The provider's API base URL (e.g. "https://api.minimaxi.com/anthropic"). */
export const providerBaseUrl = (session: AgentSession, providerId: string): string | undefined =>
  session.modelRuntime.getProvider(providerId)?.baseUrl;
