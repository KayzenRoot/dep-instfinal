import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hardenWindowsPrivatePath } from './windows-acl.mjs';
import { resolveWindowsSystem32 } from './windows-batch.mjs';

test(
	'removes inherited ACLs from a temporary directory and file',
	{ skip: process.platform !== 'win32' },
	() => {
		const workspace = mkdtempSync(join(tmpdir(), 'dif-acl-'));
		try {
			const dir = join(workspace, 'private');
			const file = join(dir, 'supervisor.log');
			mkdirSync(dir);
			writeFileSync(file, '', 'utf8');
			hardenWindowsPrivatePath(dir, { directory: true });
			hardenWindowsPrivatePath(file);
			const icacls = resolveWindowsSystem32('icacls.exe');
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
