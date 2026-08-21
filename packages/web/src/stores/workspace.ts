import { computed, reactive, ref, shallowRef, watch } from "vue";
import { createSession, listSessions, toMessage } from "@/api/client";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";
import type {
  AgentActivity,
  ExtensionWidget,
  ExtensionWidgetPlacement,
  LiveItem,
  ModelDescriptor,
  PendingMessages,
  PromptImage,
  RuntimeResources,
  SessionInfo,
  SessionStatsView,
  ThinkingState,
} from "@amagicpear/pichamber-shared";

/** 当前工作区/会话的一切状态，按官方推荐的模块级 reactive 模式统一放这里。
 *  - `workspace`：项目/会话元数据（cwd、sessionId、sessionName…）
 *  - 其余 refs：会话运行时状态（item 流、模型、stats、扩展 UI、窗口标题…），
 *    由 WS 层（useConversationSession）读写，组件直接 import 取数。
 *  useConversationSession 不再定义任何状态，只保留 WS 生命周期和动作。 */
export const workspace = reactive({
  cwd: "~" as string | null,
  folderName: null as string | null,
  sessionId: null as string | null,
  sessionName: "New Session" as string | null,
});

export const sessions = ref<SessionInfo[]>([]);
export const sessionsLoading = ref(false);
export const sessionsError = ref<string | null>(null);
// sessionsLoadPromise 用于防止重复加载会话列表
// 直接访问 session URL 时路由守卫和侧栏都需要会话列表，复用同一请求。
let sessionsLoadPromise: Promise<void> | null = null;

// 这个功能是传入一个会话，获取会话的标题
// 假如传入的是一个 ID，它就会先找这个会话的信息
// 如果直接传入会话的信息，就直接从里面读名称字段或者第一条消息
export const sessionTitle = (session: SessionInfo | string): string => {
  const sessionInfo =
    typeof session === "string" ? sessions.value.find(({ id }) => id === session) : session;
  const sessionId = typeof session === "string" ? session : session.id;

  return (
    sessionInfo?.name?.trim() ||
    sessionInfo?.firstMessage?.trim() ||
    (sessionInfo?.messageCount === 0 ? "New Session" : `Session ${sessionId}`)
  );
};

export const loadSessions = () => {
  if (sessionsLoadPromise) return sessionsLoadPromise;

  sessionsLoading.value = true;
  sessionsLoadPromise = (async () => {
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
    } catch (error) {
      sessionsError.value = toMessage(error);
      // 失败后清空缓存，允许后续调用重新加载
      sessionsLoadPromise = null;
    } finally {
      sessionsLoading.value = false;
    }
  })();

  return sessionsLoadPromise;
};

const syncWorkspaceMetadata = (sessionId: string): boolean => {
  const session = sessions.value.find(({ id }) => id === sessionId);
  if (!session || workspace.sessionId !== sessionId) return false;
  workspace.sessionName = sessionTitle(session);
  workspace.folderName = session.cwd ? pathBasename(session.cwd) : null;
  workspace.cwd = session.cwd || null;
  return true;
};

let sessionsRefreshPromise: Promise<void> | null = null;

/** Refresh the server snapshot without replacing the visible list with a loading state. */
export const refreshSessions = () => {
  if (sessionsRefreshPromise) return sessionsRefreshPromise;

  sessionsRefreshPromise = (async () => {
    if (sessionsLoadPromise) await sessionsLoadPromise;
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
      if (workspace.sessionId) syncWorkspaceMetadata(workspace.sessionId);
    } catch (error) {
      sessionsError.value = toMessage(error);
    }
  })().finally(() => {
    sessionsRefreshPromise = null;
  });

  return sessionsRefreshPromise;
};

export const createSessionForCwd = async (cwd: string) => {
  const { sessionId, cwd: resolvedCwd } = await createSession(cwd);
  workspace.sessionId = sessionId;
  workspace.cwd = resolvedCwd;
  workspace.folderName = pathBasename(resolvedCwd);
  workspace.sessionName = "New Session";
  return sessionId;
};

export const updateWorkspace = async (sessionId: string) => {
  // A freshly created empty session is active in memory before Pi persists it,
  // so it may not appear in listAll() yet. Its local metadata is authoritative.
  if (workspace.sessionId === sessionId && workspace.cwd !== null) return true;
  workspace.sessionId = sessionId;
  await loadSessions();
  if (workspace.sessionId !== sessionId) return false;
  if (sessionsError.value) return true;
  if (syncWorkspaceMetadata(sessionId)) return true;
  await refreshSessions();
  return sessionsError.value ? true : syncWorkspaceMetadata(sessionId);
};

// ─── 会话运行时状态 ─────────────────────────────────────────────────
// 由 useConversationSession 的 WS 层读写，组件只读。全部与会话元数据
// （workspace）同属"当前会话状态"，按 Vue 官方推荐的模块级 store 模式
// 放在同一个文件里，避免状态散落在 composable 中。

/** 输入框草稿。 */
export const draft = ref<string | undefined>();
export type DraftImage = PromptImage & { id: string; aspectRatio: number };
export const images = ref<DraftImage[]>([]);
export const connected = ref(false);

/** 统一 item 流：服务器铸造的稳定 id 终生不变，live→committed 只翻字段。
 *  shallowRef：流由服务器整体替换/整条重写，避免 ref 的 UnwrapRef 在
 *  递归的 LiveItem 上深层展开（TS2589）。 */
export const items = shallowRef<LiveItem[]>([]);
export const busy = ref(false);
export const activity = ref<AgentActivity>({ phase: "idle" });
export const pending = ref<PendingMessages>({ steering: [], followUp: [] });
export const canRestorePending = ref(true);
export const resources = ref<RuntimeResources>({
  commands: [],
  tools: [],
  extensions: [],
  diagnostics: [],
  extensionInventoryAvailable: false,
});

type ExtensionDialog = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
type ExtensionNotification = { id: string; message: string; type: "info" | "warning" | "error" };
type WidgetEntry = { widget: ExtensionWidget; placement: ExtensionWidgetPlacement };

export const extensionUi = reactive({
  dialog: null as ExtensionDialog | null,
  notifications: [] as ExtensionNotification[],
  statuses: {} as Record<string, string>,
  widgets: {} as Record<string, WidgetEntry>,
});

/** 空直到服务器在 snapshot/state 里确认可用模型。 */
export const availableModels = ref<ModelDescriptor[]>([]);
export const model = ref<ModelDescriptor | undefined>();
export const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
/** Pre-formatted Context-pane view; the server is the source of truth. */
export const stats = ref<SessionStatsView | undefined>();
/** Terminal window/tab title set by extensions via `ctx.ui.setTitle()`.
 *  This is a per-session host-window title (the pi protocol's
 *  `setTitle`), NOT the browser tab title on its own — it feeds the
 *  synthesized `document.title` below and is displayed by SessionHeader
 *  as a badge next to the session name. */
export const windowTitle = ref<string | undefined>();

export const canSend = computed(
  () => connected.value && (Boolean(draft.value?.trim()) || images.value.length > 0),
);

/** 浏览器标签页标题 = 会话名 · 扩展窗口标题 - PiChamber。高频更新的
 *  windowTitle（如 titlebar-spinner 动画）会如实反映到这里，这是宿主
 *  "窗口标题"语义在浏览器里的落点。 */
watch(
  [() => workspace.sessionName, windowTitle],
  ([sessionName, title]) => {
    document.title = `${[sessionName, title].filter(Boolean).join(" · ")} - PiChamber`;
  },
  { immediate: true },
);
