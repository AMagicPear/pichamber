import { DefaultPackageManager, getAgentDir, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiExtensionSource } from "@pichamber/shared";

const packageManagerFor = (session: AgentSession, cwd: string) =>
  new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager: session.settingsManager,
  });

export const listPiExtensionSources = (session: AgentSession, cwd: string): PiExtensionSource[] =>
  packageManagerFor(session, cwd).listConfiguredPackages().map((source) => ({
    source: source.source,
    scope: source.scope,
    filtered: source.filtered,
    installedPath: source.installedPath,
  }));

export const installPiExtensionSource = async (
  session: AgentSession,
  cwd: string,
  source: string,
  local: boolean,
) => {
  const manager = packageManagerFor(session, cwd);
  await manager.installAndPersist(source, { local });
  await session.settingsManager.flush();
  return listPiExtensionSources(session, cwd);
};

export const removePiExtensionSource = async (
  session: AgentSession,
  cwd: string,
  source: string,
  local: boolean,
) => {
  const manager = packageManagerFor(session, cwd);
  await manager.removeAndPersist(source, { local });
  await session.settingsManager.flush();
  return listPiExtensionSources(session, cwd);
};
