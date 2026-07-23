import { SessionManager } from "@earendil-works/pi-coding-agent";

const sessions = await SessionManager.listAll();
console.log("total:", sessions.length);
for (const s of sessions.slice(0, 5)) {
	console.log(s.cwd, "→", s.path.split("/").pop());
}