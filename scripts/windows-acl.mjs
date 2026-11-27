import { execFileSync } from 'node:child_process';
import { resolveWindowsSystem32 } from './windows-batch.mjs';

const WELL_KNOWN_SIDS = ['S-1-5-18', 'S-1-5-32-544'];

export function getCurrentUserSid(env = process.env) {
	const output = execFileSync(
		resolveWindowsSystem32('whoami.exe', env),
		['/user', '/fo', 'csv', '/nh'],
		{ encoding: 'utf8', env, windowsHide: true },
	);
	const match = output.match(/S-1-5-[\d-]+/);
	if (!match) throw new Error('Could not determine the current Windows user SID.');
	return match[0];
}

export function hardenWindowsPrivatePath(path, { directory = false, env = process.env } = {}) {
	if (process.platform !== 'win32') return path;
	const sid = getCurrentUserSid(env);
	const suffix = directory ? '(OI)(CI)F' : 'F';
	const grants = [sid, ...WELL_KNOWN_SIDS].map((grant) => `*${grant}:${suffix}`);
	execFileSync(
		resolveWindowsSystem32('icacls.exe', env),
		[path, '/inheritance:r', '/grant:r', ...grants],
		{ encoding: 'utf8', env, windowsHide: true },
	);
	return path;
}
