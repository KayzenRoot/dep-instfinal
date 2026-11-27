import assert from 'node:assert/strict';
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	prepareWorkerLogDir,
	prepareWorkerLogFile,
	readWorkerLock,
	resolveWorkerLogDir,
	writeWorkerLock,
} from './worker-log-dir.mjs';

function makeBase(prefix = 'dif-worker-log-') {
	return mkdtempSync(join(tmpdir(), prefix));
}

test('uses a per-user log directory by default', () => {
	assert.equal(
		resolveWorkerLogDir({ env: {}, homeDir: join(tmpdir(), 'dif-owner') }),
		join(tmpdir(), 'dif-owner', '.zcode', 'dif-secrets', 'worker-logs'),
	);
});

test('allows a custom absolute log directory', () => {
	const path = join(tmpdir(), 'dif-custom-worker-logs');
	assert.equal(
		resolveWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: ` ${path} ` }, homeDir: tmpdir() }),
		path,
	);
});

test('rejects a custom directory outside the user home', () => {
	const homeDir = join(tmpdir(), 'dif-owner-home');
	assert.throws(
		() =>
			resolveWorkerLogDir({
				env: { DIF_WORKER_LOG_DIR: join(tmpdir(), 'dif-outside-home') },
				homeDir,
			}),
		/under the user/,
	);
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

test('restricts Windows overrides to the user profile', () => {
	const homeDir = String.raw`C:\Users\dif`;
	assert.equal(
		resolveWorkerLogDir({
			env: { DIF_WORKER_LOG_DIR: String.raw`C:\Users\dif\logs` },
			homeDir,
			platform: 'win32',
		}),
		String.raw`C:\Users\dif\logs`,
	);
	assert.throws(
		() =>
			resolveWorkerLogDir({
				env: { DIF_WORKER_LOG_DIR: String.raw`C:\ProgramData\dif\logs` },
				homeDir,
				platform: 'win32',
			}),
		/user profile/,
	);
});

test('creates the private directory and log file with restrictive permissions', () => {
	const base = makeBase();
	try {
		const dir = prepareWorkerLogDir({
			env: { DIF_WORKER_LOG_DIR: join(base, 'private') },
			homeDir: base,
		});
		const file = prepareWorkerLogFile(join(dir, 'supervisor.log'));
		assert.equal(statSync(dir).isDirectory(), true);
		assert.equal(statSync(file).isFile(), true);
		if (process.platform !== 'win32') {
			assert.equal(statSync(dir).mode & 0o777, 0o700);
			assert.equal(statSync(file).mode & 0o777, 0o600);
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('tightens a preexisting log file and lock file', () => {
	const base = makeBase();
	try {
		const dir = prepareWorkerLogDir({
			env: { DIF_WORKER_LOG_DIR: join(base, 'private') },
			homeDir: base,
		});
		const file = join(dir, 'media.log.1');
		const lock = join(dir, 'workers-service.lock');
		writeFileSync(file, 'old log', { mode: 0o666 });
		writeFileSync(lock, '123', { mode: 0o666 });
		prepareWorkerLogFile(file);
		writeWorkerLock(lock, 456);
		assert.equal(readWorkerLock(lock), '456');
		if (process.platform !== 'win32') {
			assert.equal(statSync(file).mode & 0o777, 0o600);
			assert.equal(statSync(lock).mode & 0o777, 0o600);
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('rejects a symlinked log directory', () => {
	const base = makeBase();
	try {
		const target = join(base, 'target');
		const link = join(base, 'link');
		prepareWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: target }, homeDir: base });
		symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
		assert.throws(
			() => prepareWorkerLogDir({ env: { DIF_WORKER_LOG_DIR: link }, homeDir: base }),
			/symbolic link/,
		);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('rejects a symlinked ancestor in the log path', () => {
	const base = makeBase();
	try {
		const home = join(base, 'home');
		const target = join(base, 'target');
		const link = join(home, 'linked');
		mkdirSync(home);
		mkdirSync(target);
		symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
		assert.throws(
			() =>
				prepareWorkerLogDir({
					env: { DIF_WORKER_LOG_DIR: join(link, 'logs') },
					homeDir: home,
				}),
			/symbolic link/,
		);
		assert.equal(existsSync(join(target, 'logs')), false);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('rejects a symlinked log file', () => {
	const base = makeBase();
	try {
		const dir = prepareWorkerLogDir({
			env: { DIF_WORKER_LOG_DIR: join(base, 'private') },
			homeDir: base,
		});
		const target = join(dir, 'target.log');
		const link = join(dir, 'link.log');
		prepareWorkerLogFile(target);
		symlinkSync(target, link, 'file');
		assert.throws(() => prepareWorkerLogFile(link), /symbolic link/);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test('rejects a hard-linked log file on POSIX', { skip: process.platform === 'win32' }, () => {
	const base = makeBase();
	try {
		const dir = prepareWorkerLogDir({
			env: { DIF_WORKER_LOG_DIR: join(base, 'private') },
			homeDir: base,
		});
		const file = join(dir, 'media.log');
		const hardLink = join(dir, 'media-copy.log');
		prepareWorkerLogFile(file);
		linkSync(file, hardLink);
		assert.throws(() => prepareWorkerLogFile(file), /hard link/);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
