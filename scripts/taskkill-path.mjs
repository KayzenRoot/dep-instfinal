import { isAbsolute, join } from 'node:path';

/**
 * Resolve taskkill from the fixed Windows system directory instead of searching
 * PATH, so the supervisor never executes a writable-directory binary.
 */
export function resolveTaskkillPath(environment = process.env) {
	const systemRoot = environment.SystemRoot?.trim() || 'C:\\Windows';
	const command = join(systemRoot, 'System32', 'taskkill.exe');
	if (!isAbsolute(command)) throw new Error('taskkill path must be absolute');
	return command;
}
