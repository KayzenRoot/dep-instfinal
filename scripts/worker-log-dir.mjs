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
