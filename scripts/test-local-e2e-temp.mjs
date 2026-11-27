import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenWindowsPrivatePath } from './windows-acl.mjs';

/** Private scratch directory for the disposable E2E stack. */
export function preparePrivateTempDir(baseDir = tmpdir()) {
	const dir = mkdtempSync(join(baseDir, 'dif-e2e-'));
	if (process.platform === 'win32') {
		hardenWindowsPrivatePath(dir, { directory: true });
	} else {
		chmodSync(dir, 0o700);
	}
	return dir;
}

export function cleanupPrivateTempDir(dir) {
	if (dir) rmSync(dir, { recursive: true, force: true });
}
