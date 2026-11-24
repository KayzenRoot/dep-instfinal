import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveWorkerLogDir } from './worker-log-dir.mjs';

test('uses a per-user log directory by default', () => {
	assert.equal(
		resolveWorkerLogDir({ env: {}, homeDir: join(tmpdir(), 'dif-owner') }),
		join(tmpdir(), 'dif-owner', '.zcode', 'dif-secrets', 'worker-logs'),
	);
});

test('allows a custom absolute log directory', () => {
	const path = join(tmpdir(), 'dif-custom-worker-logs');
	assert.equal(resolveWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: ` ${path} ` } }), path);
});

test('rejects a relative override to avoid logs in the repository', () => {
	assert.throws(
		() => resolveWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: './private-logs' } }),
		/absolute path/,
	);
});

test('treats whitespace-only overrides as unset', () => {
	assert.equal(
		resolveWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: '  ' }, homeDir: tmpdir() }),
		join(tmpdir(), '.zcode', 'dif-secrets', 'worker-logs'),
	);
});
