import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSupabaseCommand } from './supabase-command.mjs';

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
