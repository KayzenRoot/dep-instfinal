import { win32 } from 'node:path';

/** Use the protected Windows System32 executable, never a PATH-resolved name. */
export function resolveTaskkillPath(env = process.env) {
	const systemRoot = env.SystemRoot;
	if (!systemRoot || !/^[a-z]:\\windows\\?$/i.test(win32.normalize(systemRoot))) {
		throw new Error('SystemRoot must point to the local Windows system directory.');
	}
	return win32.join(systemRoot, 'System32', 'taskkill.exe');
}
