import * as crypto from "node:crypto";
import type {
  ExtensionUIContext,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  Theme,
} from "@earendil-works/pi-coding-agent";

/**
 * The browser implements Pi's documented RPC extension-UI protocol. This
 * describes the extension host, not whether pichamber runs Pi in-process.
 */
export const WEB_EXTENSION_HOST_MODE = "rpc" as const;

type PendingDialog = {
  resolve: (response: RpcExtensionUIResponse) => void;
};

/** Omit 在联合类型上不分配，这里手动做分配版。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type UiBridge = {
  /** 作为官方 ExtensionUIContext 绑定到 session（bindExtensions）。 */
  context: ExtensionUIContext;
  /** 处理客户端的 extension_ui_response，派发给挂起的对话框。 */
  handleResponse: (response: RpcExtensionUIResponse) => void;
  /** 频道销毁时取消所有挂起请求（按取消语义 resolve 默认值）。 */
  cancelPending: () => void;
};

/**
 * 移植官方 RPC 模式（rpc-mode.js createExtensionUIContext）：扩展的 ui.*
 * 调用转发为官方 extension_ui_request 消息，等客户端 extension_ui_response
 * 应答；超时/中止按官方
 * 语义 resolve 默认值。帧结构与官方 extension_ui_request/response 完全同构，
 * 未来切换到 RPC 模式时协议零改动。
 */
export const createUiBridge = (send: (request: RpcExtensionUIRequest) => void): UiBridge => {
  const pending = new Map<string, PendingDialog>();

  const createDialogPromise = <T, R extends RpcExtensionUIRequest>(
    opts: { signal?: AbortSignal; timeout?: number } | undefined,
    defaultValue: T,
    request: DistributiveOmit<R, "id">,
    parseResponse: (response: RpcExtensionUIResponse) => T,
  ): Promise<T> => {
    if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
    const id = crypto.randomUUID();
    return new Promise<T>((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", onAbort);
        pending.delete(id);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }
      pending.set(id, {
        resolve: (response) => {
          cleanup();
          resolve(parseResponse(response));
        },
      });
      send({ ...request, id });
    });
  };

  const parseDialogResponse = (response: RpcExtensionUIResponse): string | undefined =>
    "cancelled" in response && response.cancelled ? undefined : "value" in response ? response.value : undefined;

  /** Web 主题桩：样式方法原样返回文本（ANSI 转义对浏览器无意义）。 */
  const webTheme = {
    fg: (_color: unknown, text: string) => text,
    bg: (_color: unknown, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (text: string) => text,
    getBashModeBorderColor: () => (text: string) => text,
  } as unknown as Theme;

  const setEditorText = (text: string) => {
    send({ type: "extension_ui_request", id: crypto.randomUUID(), method: "set_editor_text", text });
  };

  const context: ExtensionUIContext = {
    select: (title, options, opts) =>
      createDialogPromise(
        opts,
        undefined,
        { type: "extension_ui_request", method: "select", title, options, timeout: opts?.timeout },
        parseDialogResponse,
      ),
    confirm: (title, message, opts) =>
      createDialogPromise(
        opts,
        false,
        { type: "extension_ui_request", method: "confirm", title, message, timeout: opts?.timeout },
        (response) =>
          "cancelled" in response && response.cancelled ? false : "confirmed" in response ? response.confirmed : false,
      ),
    input: (title, placeholder, opts) =>
      createDialogPromise(
        opts,
        undefined,
        { type: "extension_ui_request", method: "input", title, placeholder, timeout: opts?.timeout },
        parseDialogResponse,
      ),
    editor: (title, prefill) =>
      createDialogPromise(
        undefined,
        undefined,
        { type: "extension_ui_request", method: "editor", title, prefill },
        parseDialogResponse,
      ),
    notify(message, type) {
      send({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message, notifyType: type });
    },
    onTerminalInput() {
      // 原始终端输入只在交互模式支持
      return () => {};
    },
    setStatus(statusKey, statusText) {
      send({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey, statusText });
    },
    setWorkingMessage() {
      // 需要 TUI loader 支持
    },
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget(key, content, options) {
      // 只支持字符串数组，组件工厂需要 TUI 支持
      if (content === undefined || Array.isArray(content)) {
        send({
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        });
      }
    },
    setFooter() {
      // 自定义 footer 需要 TUI 支持
    },
    setHeader() {},
    setTitle(title) {
      send({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setTitle", title });
    },
    async custom<T>(): Promise<T> {
      // 自定义组件 UI 需要 TUI 支持
      return undefined as unknown as T;
    },
    pasteToEditor(text) {
      setEditorText(text);
    },
    setEditorText,
    getEditorText() {
      // 同步方法无法等 RPC 往返
      return "";
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    get theme() {
      return webTheme;
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "Themes are not supported in pichamber" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };

  return {
    context,
    handleResponse(response) {
      pending.get(response.id)?.resolve(response);
    },
    cancelPending() {
      for (const [id, dialog] of pending) {
        dialog.resolve({ type: "extension_ui_response", id, cancelled: true });
      }
    },
  };
};
