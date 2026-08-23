/**
 * @amagicpear/pichamber-shared 统一出口。
 *
 * 按领域拆分后各模块从这汇聚；官方已有的类型（AgentMessage/
 * AgentSessionEvent/ImageContent/WidgetPlacement/…）直接从官方包
 * re-export，消费方只 import 这一个入口。
 */
export * from "./paths";
export * from "./session";
export * from "./providers";
export * from "./git";
export * from "./fs";
export * from "./pty";
export * from "./server";

export type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
export type {
  AgentSessionEvent,
  JsonAgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionEntry,
  SessionInfo,
  SlashCommandInfo,
  SourceInfo,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
export type { ImageContent } from "@earendil-works/pi-ai";
