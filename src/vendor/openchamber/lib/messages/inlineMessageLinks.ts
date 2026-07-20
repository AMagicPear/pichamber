// Vendored stub. OpenChamber's `inlineMessageLinks` recognizes agent mention
// (#openchamber-agent:Name) and skill (#openchamber-skill:Name) link schemes
// and rewrites them into clickable links. Pichamber doesn't have a multi-agent
// system, so we keep the same shape so markdownCore stays happy — consumers
// downstream treat unknown schemes as opaque hrefs.
const SKILL_LINK_PREFIX = '#openchamber-skill:';
const AGENT_LINK_PREFIX = '#openchamber-agent:';

export const buildAgentMentionUrl = (name: string): string => {
  const encoded = encodeURIComponent(name);
  return `https://opencode.ai/docs/agents/#${encoded}`;
};

export const buildSkillHref = (name: string): string =>
  `${SKILL_LINK_PREFIX}${encodeURIComponent(name)}`;

export const parseSkillHref = (href: string | null | undefined): string | null => {
  if (!href?.startsWith(SKILL_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(SKILL_LINK_PREFIX.length));
  } catch {
    return null;
  }
};

export const parseAgentHref = (href: string | null | undefined): string | null => {
  if (!href?.startsWith(AGENT_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(AGENT_LINK_PREFIX.length));
  } catch {
    return null;
  }
};