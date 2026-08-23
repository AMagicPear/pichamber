import { reactive } from "vue";
import type { RpcExtensionUIRequest, WidgetPlacement } from "@earendil-works/pi-coding-agent";
import { normalizeExtensionWidget, type ExtensionWidget } from "@/composables/extensionWidgets";
import { createId } from "@/utils/id";

/** 扩展 UI 装饰（对话框队列、toast、status / widget 落点）。
 *  与会话运行时状态不同生命周期，单独成模块；WS `ui_request` 帧
 *  的扩展 UI 部分由 `applyExtensionUiRequest` 入口统一处理。
 *  注：`setTitle` / `set_editor_text` 改的是 workspace 自己的 state，
 *  不在本模块，由 applyServerMessage 显式调度。 */

type ExtensionDialog = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
type ExtensionNotification = { id: string; message: string; type: "info" | "warning" | "error" };
type WidgetEntry = { widget: ExtensionWidget; placement: WidgetPlacement };

const TOAST_TTL_MS = 5_000;

export const extensionUi = reactive({
  dialog: null as ExtensionDialog | null,
  notifications: [] as ExtensionNotification[],
  statuses: {} as Record<string, string>,
  widgets: {} as Record<string, WidgetEntry>,
});

const extensionDialogQueue: ExtensionDialog[] = [];

/** 弹出队列里的下一个扩展对话框（当前对话框应答后调用）。 */
export const showNextExtensionDialog = () => {
  extensionUi.dialog = extensionDialogQueue.shift() ?? null;
};

/** Push a transport / model / thinking / catastrophic-prompt error onto the
 *  shared toast queue. The toast auto-dismisses after 5s and can be closed
 *  manually, matching the lifecycle of extension notifications. */
export const pushErrorToast = (message: string) => {
  const id = `error-${createId()}`;
  extensionUi.notifications.push({ id, message, type: "error" });
  setTimeout(() => dismissNotification(id), TOAST_TTL_MS);
};

/** Push a neutral confirmation toast (e.g. "Copied to clipboard") onto the
 *  same shared queue. */
export const pushInfoToast = (message: string) => {
  const id = `info-${createId()}`;
  extensionUi.notifications.push({ id, message, type: "info" });
  setTimeout(() => dismissNotification(id), TOAST_TTL_MS);
};

export const dismissNotification = (id: string) => {
  const index = extensionUi.notifications.findIndex((n) => n.id === id);
  if (index !== -1) extensionUi.notifications.splice(index, 1);
};

/** 扩展 `ui.*` 请求里属于扩展 UI 装饰的分支（对话框、toast、status、widget）。
 *  请求是官方 RPC 形状原样转发；setWidget 的 widget 行在这里解析成
 *  结构化 `ExtensionWidget`（tree / lines）。 */
export const applyExtensionUiRequest = (request: RpcExtensionUIRequest) => {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      if (extensionUi.dialog) extensionDialogQueue.push(request);
      else extensionUi.dialog = request;
      break;
    case "notify":
      extensionUi.notifications.push({
        id: request.id,
        message: request.message,
        type: request.notifyType ?? "info",
      });
      setTimeout(() => dismissNotification(request.id), TOAST_TTL_MS);
      break;
    case "setStatus":
      if (request.statusText) extensionUi.statuses[request.statusKey] = request.statusText;
      else delete extensionUi.statuses[request.statusKey];
      break;
    case "setWidget":
      if (request.widgetLines) {
        const widget = normalizeExtensionWidget(request.widgetKey, request.widgetLines);
        if (widget) {
          extensionUi.widgets[request.widgetKey] = {
            widget,
            placement: request.widgetPlacement ?? "aboveEditor",
          };
        } else delete extensionUi.widgets[request.widgetKey];
      } else delete extensionUi.widgets[request.widgetKey];
      break;
    case "setTitle":
    case "set_editor_text":
      // 改的是 workspace.state（windowTitle / draft），不在本模块处理。
      break;
  }
};

/** 断连 / 换会话时由 `resetSessionState` 调用。 */
export const resetExtensionUi = () => {
  extensionUi.dialog = null;
  extensionDialogQueue.splice(0);
  extensionUi.notifications.splice(0);
  for (const key of Object.keys(extensionUi.statuses)) delete extensionUi.statuses[key];
  for (const key of Object.keys(extensionUi.widgets)) delete extensionUi.widgets[key];
};
