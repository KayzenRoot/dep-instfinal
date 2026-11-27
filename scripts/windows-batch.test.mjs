import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { resolveSupabaseCommand, resolveSupabaseInvocation } from './supabase-command.mjs';
import {
	assertSafeBatchPath,
	buildBatchCommandLine,
	quoteBatchArgument,
	runWindowsBatchFile,
} from './windows-batch.mjs';

test('accepts only absolute local .cmd or .bat paths', () => {
	assert.equal(
		assertSafeBatchPath(String.raw`C:\Tools\supabase.cmd`),
		String.raw`C:\Tools\supabase.cmd`,
	);
	assert.throws(() => assertSafeBatchPath('supabase.cmd'), /absolute/);
	assert.throws(() => assertSafeBatchPath(String.raw`\\server\share\supabase.cmd`), /UNC/);
	assert.throws(() => assertSafeBatchPath('//server/share/supabase.cmd'), /UNC/);
	assert.throws(() => assertSafeBatchPath('//?/UNC/server/share/supabase.cmd'), /UNC/);
	assert.throws(() => assertSafeBatchPath(String.raw`C:\Tools\supabase.exe`), /\.cmd or \.bat/);
});

test('rejects cmd.exe metacharacters in paths and arguments', () => {
	assert.throws(() => assertSafeBatchPath(String.raw`C:\Tools\bad&name.cmd`), /interpret/);
	assert.throws(() => assertSafeBatchPath(String.raw`C:\Tools\bad%TEMP%.cmd`), /interpret/);
	assert.throws(() => assertSafeBatchPath(String.raw`C:\Tools\bad"name.cmd`), /interpret/);
	assert.throws(() => quoteBatchArgument('value & calc.exe'), /interpret/);
	assert.equal(quoteBatchArgument('beta gamma'), '"beta gamma"');
});

test('builds a double-quoted cmd.exe command line for paths with spaces', () => {
	assert.equal(
		buildBatchCommandLine(String.raw`C:\Program Files\dif\supabase.cmd`, [
			'status',
			'--output',
			'env',
		]),
		String.raw`""C:\Program Files\dif\supabase.cmd" status --output env"`,
	);
});

test(
	'executes a real batch fixture from a path with spaces and returns its exit code',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif batch (x86) '));
		try {
			const fixture = join(workspace, 'fixture with spaces.cmd');
			writeFileSync(
				fixture,
				'@echo off\r\necho arg1=[%~1]\r\necho arg2=[%~2]\r\nexit /b 7\r\n',
				'utf8',
			);
			assert.throws(
				() => runWindowsBatchFile(fixture, ['alpha', 'beta gamma']),
				(error) => {
					assert.equal(error.status, 7);
					assert.equal(error.stdout, 'arg1=[alpha]\r\narg2=[beta gamma]\r\n');
					return true;
				},
			);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);

test(
	'executes the real Supabase CLI with a hostile PATH',
	{ skip: process.platform !== 'win32' },
	(t) => {
		let command;
		const workspace = mkdtempSync(join(tmpdir(), 'dif supabase (x86) '));
		try {
			const env = { ...process.env, APPDATA: process.env.APPDATA };
			try {
				command = resolveSupabaseCommand({ env });
			} catch {
				t.skip('Supabase CLI is not installed on this Windows host.');
				return;
			}
			const junction = join(workspace, 'npm-link');
			symlinkSync(dirname(command), junction, 'junction');
			const viaJunction = join(junction, basename(command));
			const invocation = resolveSupabaseInvocation({
				env: { ...process.env, SUPABASE_BIN: viaJunction },
			});
			const hostile = join(workspace, 'hostile path');
			mkdirSync(hostile);
			writeFileSync(join(hostile, 'node.exe'), '', 'utf8');
			const output = execFileSync(invocation.command, [...invocation.args, '--version'], {
				encoding: 'utf8',
				env: { ...process.env, PATH: hostile },
			});
			assert.match(output.trim(), /^\d+\.\d+\.\d+/);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	},
);
