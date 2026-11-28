import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenWindowsPrivatePath } from './windows-acl.mjs';

/** Private scratch directory for the disposable E2E stack. */
export function preparePrivateTempDir(
	baseDir = tmpdir(),
	{ harden = hardenWindowsPrivatePath } = {},
) {
	const dir = mkdtempSync(join(baseDir, 'dif-e2e-'));
	try {
		if (process.platform === 'win32') {
			harden(dir, { directory: true });
		} else {
			chmodSync(dir, 0o700);
		}
		return dir;
	} catch (error) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Preserve the original preparation error.
		}
		throw error;
	}
}

export function cleanupPrivateTempDir(dir) {
	if (dir) rmSync(dir, { recursive: true, force: true });
}
