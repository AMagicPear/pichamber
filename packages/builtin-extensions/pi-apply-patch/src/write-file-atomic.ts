import { constants } from "node:fs";
import { access, chmod, lstat, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AtomicWriteOperations = {
	writeFile: (filePath: string, content: string, options: { encoding: "utf-8"; flag: "wx"; mode: number }) => Promise<void>;
	 rename: (fromPath: string, toPath: string) => Promise<void>;
	 unlink: (filePath: string) => Promise<void>;
	access: typeof access;
	chmod: typeof chmod;
	lstat: typeof lstat;
	realpath: typeof realpath;
	stat: typeof stat;
};

const ATOMIC_WRITE_OPERATIONS: AtomicWriteOperations = {
	access,
	chmod,
	lstat,
	realpath,
	stat,
	writeFile,
	rename,
	unlink,
};

const hasErrorCode = (error: unknown, code: string) => {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
};

export const writeFileAtomic = async (
	absPath: string,
	content: string,
	mode?: number,
	operations: AtomicWriteOperations = ATOMIC_WRITE_OPERATIONS,
) => {
	const existing = await operations.lstat(absPath).catch((error: unknown) => {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	});
	// Replace the referent, not the symlink itself. Dangling links fail without being destroyed.
	const target = existing?.isSymbolicLink() ? await operations.realpath(absPath) : absPath;
	if (existing) {
		await operations.access(target, constants.W_OK);
		mode = Number((await operations.stat(target)).mode) & 0o7777;
	}
	const tempPath = join(dirname(target), `.apply-patch-${crypto.randomUUID()}`);
	let written = false;
	try {
		await operations.writeFile(tempPath, content, { encoding: "utf-8", flag: "wx", mode: mode ?? 0o666 });
		written = true;
		if (mode !== undefined) await operations.chmod(tempPath, mode);
		await operations.rename(tempPath, target);
	} catch (error) {
		// Never unlink the original, or a temporary file owned by another writer.
		if (written || !hasErrorCode(error, "EEXIST")) {
			await operations.unlink(tempPath).catch(() => {});
		}
		throw error;
	}
};
