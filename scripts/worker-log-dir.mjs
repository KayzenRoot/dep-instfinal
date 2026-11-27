import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function resolveWorkerLogDir({ env = process.env, homeDir = homedir() } = {}) {
	const configured = env.DIF_WORKER_LOG_DIR?.trim();
	if (configured) {
		if (!isAbsolute(configured)) throw new Error('DIF_WORKER_LOG_DIR must be an absolute path.');
		return configured;
	}
	return join(homeDir, '.zcode', 'dif-secrets', 'worker-logs');
}

export function prepareWorkerLogDir(options = {}) {
	const dir = resolveWorkerLogDir(options);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') chmodSync(dir, 0o700);
	return dir;
}

export function prepareWorkerLogFile(path) {
	writeFileSync(path, '', { flag: 'a', mode: 0o600 });
	if (process.platform !== 'win32') chmodSync(path, 0o600);
	return path;
}
