import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import type { RuntimeSlashCommand } from "@amagicpear/pichamber-shared";

/** 浏览器包不能引入 pi 运行时（会带 `process` 等 Node 依赖），
 *  与 pi 的 `createSyntheticSourceInfo` 输出同形的本地工厂。 */
const builtinSourceInfo = (name: string): SourceInfo => ({
  path: `builtin:${name}`,
  source: "pi-builtin",
  scope: "temporary",
  origin: "top-level",
});

/**
 * 前端内置 slash 命令。
 *
 * 拥有两件事：
 * 1. GUI 内置命令 shelf（`BUILTIN_COMMANDS`）：进 `shelfCommands` 让用户在
 *    输入框里能发现 /compact、/reload。只列有干净后端动作的 builtin——
 *    TUI 专属流程（/new、/name、/resume、/fork、/clone）在 web 里没有对应
 *    后端函数（提交只会把文本原样发给模型），所以不进 shelf。
 * 2. 提交路由（`matchBuiltinCommand`）：匹配到的 builtin 不离开客户端当
 *    `prompt` 消息发——`useConversationSession.prompt()` 在这里先匹配，
 *    然后派发到 `compact`/`reload` WS 帧，直连后端动作。
 *    其余（扩展命令、prompt 模板、skill 命令、普通文本）照旧走 `prompt` 帧。
 */

/** 有 GUI 直接动作的 builtin，按匹配优先级排列。 */
const GUI_BUILTIN_COMMANDS = ["reload", "compact"] as const;

/** 命令选择器 shelf 里的内置条目（描述对齐 TUI 的 builtin 提示）。 */
export const BUILTIN_COMMANDS: RuntimeSlashCommand[] = [
  {
    name: "compact",
    description: "Manually compact the session context",
    source: "builtin",
    sourceInfo: builtinSourceInfo("compact"),
  },
  {
    name: "reload",
    description: "Reload extensions, prompts, themes, and context files",
    source: "builtin",
    sourceInfo: builtinSourceInfo("reload"),
  },
];

/** A matched built-in command. `customInstructions` follows the naming the
 *  TUI's runtime reads out of `/compact …` (`interactive-mode.js`); `null`
 *  when the command carries no argument. */
export type BuiltinCommand = {
  name: string;
  customInstructions: string | null;
};

/** Trim then match by prefix — `/reload ` with trailing whitespace still
 *  hits the reload branch, and any text starting with `/compact` is
 *  treated as a compact with that instruction body. */
export const matchBuiltinCommand = (text: string): BuiltinCommand | null => {
  const trimmed = text.trim();
  for (const name of GUI_BUILTIN_COMMANDS) {
    if (trimmed.startsWith(`/${name}`)) {
      const customInstructions = trimmed.slice(name.length + 1).trim();
      return { name, customInstructions: customInstructions || null };
    }
  }
  return null;
};
