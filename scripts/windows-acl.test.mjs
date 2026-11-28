import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getCurrentUserSid, getWindowsAclSids, hardenWindowsPrivatePath } from './windows-acl.mjs';
import { resolveWindowsSystem32 } from './windows-batch.mjs';
import { prepareWorkerLogDir, prepareWorkerLogFile, writeWorkerLock } from './worker-log-dir.mjs';

const ALLOWED = new Set(['S-1-5-18', 'S-1-5-32-544']);

function assertAllowlist(path) {
	const expected = new Set([getCurrentUserSid(), ...ALLOWED]);
	const actual = new Set(getWindowsAclSids(path));
	assert.deepEqual(actual, expected);
	assert.equal(actual.has('S-1-1-0'), false);
}

test(
	'removes explicit and inherited ACEs from a directory and file',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif-acl-'));
		try {
			const dir = join(workspace, 'private');
			const file = join(dir, 'supervisor.log');
			mkdirSync(dir);
			writeFileSync(file, '', 'utf8');
			const icacls = resolveWindowsSystem32('icacls.exe');
			execFileSync(icacls, [dir, '/grant', '*S-1-1-0:(OI)(CI)F']);
			execFileSync(icacls, [file, '/grant', '*S-1-1-0:F']);
			assert.equal(getWindowsAclSids(dir).includes('S-1-1-0'), true);
			assert.equal(getWindowsAclSids(file).includes('S-1-1-0'), true);
			hardenWindowsPrivatePath(dir, { directory: true });
			hardenWindowsPrivatePath(file);
			assertAllowlist(dir);
			assertAllowlist(file);
			for (const target of [dir, file]) {
				const output = execFileSync(icacls, [target], { encoding: 'utf8' });
				assert.equal(output.includes('(I)'), false);
				assert.match(output, /\(F\)/);
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test(
	'rebuilds exact rights when the SIDs are preserved but rights differ',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif-acl-rights-'));
		try {
			const dir = join(workspace, 'private');
			const file = join(dir, 'supervisor.log');
			mkdirSync(dir);
			writeFileSync(file, '', 'utf8');
			hardenWindowsPrivatePath(dir, { directory: true });
			hardenWindowsPrivatePath(file);
			const icacls = resolveWindowsSystem32('icacls.exe');
			const sid = getCurrentUserSid();
			execFileSync(icacls, [dir, '/grant:r', `*${sid}:(OI)(CI)R`]);
			execFileSync(icacls, [file, '/grant:r', `*${sid}:R`]);
			hardenWindowsPrivatePath(dir, { directory: true });
			hardenWindowsPrivatePath(file);
			assertAllowlist(dir);
			assertAllowlist(file);
			for (const target of [dir, file]) {
				const output = execFileSync(icacls, [target], { encoding: 'utf8' });
				assert.match(output, /\(F\)/);
				assert.equal(output.includes('(R)'), false);
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test(
	'rebuilds when each principal is individually absent',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif-acl-missing-'));
		try {
			const dir = join(workspace, 'private');
			mkdirSync(dir);
			hardenWindowsPrivatePath(dir, { directory: true });
			const icacls = resolveWindowsSystem32('icacls.exe');
			for (const sid of [getCurrentUserSid(), 'S-1-5-18', 'S-1-5-32-544']) {
				execFileSync(icacls, [dir, '/remove:g', `*${sid}`]);
				assert.equal(getWindowsAclSids(dir).includes(sid), false);
				hardenWindowsPrivatePath(dir, { directory: true });
				assertAllowlist(dir);
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test(
	'does not accept duplicate or incomplete SID sets in the fast path',
	{ skip: process.platform !== 'win32' },
	() => {
		const expected = [getCurrentUserSid(), 'S-1-5-18', 'S-1-5-32-544'];
		for (const initial of [
			[expected[0], expected[0], expected[0]],
			[expected[0], expected[1]],
			[...expected, 'S-1-1-0'],
		]) {
			let applied = 0;
			const inspect = () => ({ exact: true, sids: applied === 0 ? initial : expected });
			const apply = () => {
				applied += 1;
			};
			hardenWindowsPrivatePath(String.raw`C:\fake-private`, {
				directory: true,
				inspect,
				apply,
			});
			assert.equal(applied, 1);
		}
	},
);

test(
	'allowlists preexisting log, lock and rotated file ACLs',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif-acl-logs-'));
		try {
			const dir = prepareWorkerLogDir({
				env: { DIF_WORKER_LOG_DIR: join(workspace, 'worker logs') },
				homeDir: workspace,
			});
			const rotated = join(dir, 'media.log.1');
			const lock = join(dir, 'workers-service.lock');
			writeFileSync(rotated, 'old', 'utf8');
			writeFileSync(lock, '1', 'utf8');
			const icacls = resolveWindowsSystem32('icacls.exe');
			for (const target of [rotated, lock]) {
				execFileSync(icacls, [target, '/grant', '*S-1-1-0:F']);
				assert.equal(getWindowsAclSids(target).includes('S-1-1-0'), true);
			}
			prepareWorkerLogFile(rotated);
			writeWorkerLock(lock, 2);
			assertAllowlist(rotated);
			assertAllowlist(lock);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);
