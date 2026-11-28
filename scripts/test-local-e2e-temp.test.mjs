import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanupPrivateTempDir, preparePrivateTempDir } from './test-local-e2e-temp.mjs';
import { getCurrentUserSid, getWindowsAclSids } from './windows-acl.mjs';

test('creates a private per-run temporary directory', () => {
	const base = mkdtempSync(join(tmpdir(), 'dif-e2e-base-'));
	try {
		const dir = preparePrivateTempDir(base);
		assert.equal(existsSync(dir), true);
		assert.ok(dir.startsWith(base));
		if (process.platform !== 'win32') {
			assert.equal(statSync(dir).mode & 0o777, 0o700);
		} else {
			assert.deepEqual(
				new Set(getWindowsAclSids(dir)),
				new Set([getCurrentUserSid(), 'S-1-5-18', 'S-1-5-32-544']),
			);
		}
		cleanupPrivateTempDir(dir);
		assert.equal(existsSync(dir), false);
	} finally {
		cleanupPrivateTempDir(base);
	}
});

test(
	'removes the temporary child when hardening fails',
	{ skip: process.platform !== 'win32' },
	() => {
		const base = mkdtempSync(join(tmpdir(), 'dif-e2e-fail-'));
		let created;
		try {
			assert.throws(
				() =>
					preparePrivateTempDir(base, {
						harden: (dir) => {
							created = dir;
							throw new Error('hardening failed');
						},
					}),
				/hardening failed/,
			);
			assert.equal(existsSync(created), false);
		} finally {
			cleanupPrivateTempDir(base);
		}
	},
);
