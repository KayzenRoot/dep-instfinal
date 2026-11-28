import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSupabaseCommand, resolveSupabaseInvocation } from './supabase-command.mjs';

test('uses an absolute SUPABASE_BIN override on POSIX', () => {
	assert.equal(
		resolveSupabaseCommand({
			env: { SUPABASE_BIN: '/opt/tools/supabase' },
			platform: 'linux',
			exists: () => false,
		}),
		'/opt/tools/supabase',
	);
});

test('rejects a relative SUPABASE_BIN override', () => {
	assert.throws(
		() =>
			resolveSupabaseCommand({
				env: { SUPABASE_BIN: './supabase' },
				platform: 'linux',
				exists: () => false,
			}),
		/absolute path/,
	);
});

test('finds the Windows npm shim without resolving it through PATH', () => {
	const appData = String.raw`C:\Users\dif\AppData\Roaming`;
	const candidate = String.raw`C:\Users\dif\AppData\Roaming\npm\supabase.cmd`;
	assert.equal(
		resolveSupabaseCommand({
			env: { APPDATA: appData, PATH: String.raw`C:\untrusted` },
			platform: 'win32',
			exists: (path) => path === candidate,
		}),
		candidate,
	);
});

test('rejects UNC, extended UNC, root-relative and device Windows paths', () => {
	for (const command of [
		String.raw`\\server\share\supabase.cmd`,
		'//server/share/supabase.cmd',
		'//?/UNC/server/share/supabase.cmd',
		String.raw`\\?\C:\Tools\supabase.cmd`,
		String.raw`\Tools\supabase.cmd`,
	]) {
		assert.throws(
			() =>
				resolveSupabaseCommand({
					env: { SUPABASE_BIN: command },
					platform: 'win32',
					exists: () => false,
				}),
			/local drive-absolute/,
		);
	}
});

test('accepts an absolute Windows SUPABASE_BIN override', () => {
	const override = String.raw`C:\Tools\supabase\supabase.exe`;
	assert.equal(
		resolveSupabaseCommand({
			env: { SUPABASE_BIN: override },
			platform: 'win32',
			exists: () => false,
		}),
		override,
	);
});

test('fails closed when no absolute CLI candidate exists', () => {
	assert.throws(
		() =>
			resolveSupabaseCommand({
				env: { PATH: String.raw`C:\untrusted` },
				platform: 'win32',
				exists: () => false,
			}),
		/absolute Supabase CLI path/,
	);
});

test('runs an npm Windows shim through the current Node executable, not PATH', () => {
	const shim = String.raw`C:\Users\dif\AppData\Roaming\npm\supabase.cmd`;
	const entry = String.raw`C:\Users\dif\AppData\Roaming\npm\node_modules\supabase\dist\supabase.js`;
	const nodeExecutable = String.raw`C:\Program Files\nodejs\node.exe`;
	assert.deepEqual(
		resolveSupabaseInvocation({
			env: { SUPABASE_BIN: shim, PATH: String.raw`C:\hostile` },
			platform: 'win32',
			exists: (path) => path === shim || path === entry,
			nodeExecutable,
		}),
		{ command: nodeExecutable, args: [entry], kind: 'node-script' },
	);
});

test('fails closed when a .cmd shim has no local Supabase JS entry', () => {
	const shim = String.raw`C:\Users\dif\AppData\Roaming\npm\supabase.cmd`;
	assert.throws(
		() =>
			resolveSupabaseInvocation({
				env: { SUPABASE_BIN: shim },
				platform: 'win32',
				exists: (path) => path === shim,
			}),
		/no local dist\/supabase\.js/,
	);
});

test('runs a native Supabase executable directly', () => {
	const command = String.raw`C:\Tools\supabase\supabase.exe`;
	assert.deepEqual(
		resolveSupabaseInvocation({
			env: { SUPABASE_BIN: command },
			platform: 'win32',
			exists: () => false,
		}),
		{ command, args: [], kind: 'native' },
	);
});
