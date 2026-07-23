import { SessionManager } from "@earendil-works/pi-coding-agent";

// 列出所有的会话
const sessions = await SessionManager.listAll();
// 打开第一个会话
const firstSession = SessionManager.open(sessions[0].path);
console.assert(firstSession.getSessionFile() == sessions[0].path);
// 看第一个会话的entry
const firstSessionEntries = firstSession.getEntries();
console.log(firstSessionEntries[0].type);

// 创建Runtime
// const runtime = await createAgentSessionRuntime(createRuntime, {
//   ,
//   agentDir: getAgentDir(),
//   sessionManager: SessionManager.open(firstSession.getSessionFile()),
// });
