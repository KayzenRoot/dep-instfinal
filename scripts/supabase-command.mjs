import { existsSync } from 'node:fs';
import { isAbsolute, win32 } from 'node:path';

const POSIX_CANDIDATES = [
	'/usr/local/bin/supabase',
	'/usr/bin/supabase',
	'/opt/homebrew/bin/supabase',
];

function windowsCandidates(env) {
	const candidates = [];
	const appData = env.APPDATA?.trim();
	const localAppData = env.LOCALAPPDATA?.trim();
	const userProfile = env.USERPROFILE?.trim();
	const programFiles = (env.ProgramFiles ?? env.PROGRAMFILES)?.trim();
	if (appData) {
		candidates.push(
			win32.join(appData, 'npm', 'supabase.exe'),
			win32.join(appData, 'npm', 'supabase.cmd'),
		);
	}
	if (localAppData) {
		candidates.push(
			win32.join(localAppData, 'Programs', 'supabase', 'supabase.exe'),
			win32.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'supabase.exe'),
		);
	}
	if (userProfile) candidates.push(win32.join(userProfile, 'scoop', 'shims', 'supabase.exe'));
	if (programFiles) candidates.push(win32.join(programFiles, 'Supabase', 'supabase.exe'));
	return candidates;
}

export function resolveSupabaseCommand({
	env = process.env,
	platform = process.platform,
	exists = existsSync,
} = {}) {
	const configured = env.SUPABASE_BIN?.trim();
	const isAbsolutePath = platform === 'win32' ? win32.isAbsolute : isAbsolute;
	if (configured) {
		if (!isAbsolutePath(configured)) throw new Error('SUPABASE_BIN must be an absolute path.');
		return configured;
	}
	const candidates = platform === 'win32' ? windowsCandidates(env) : POSIX_CANDIDATES;
	const found = candidates.find((candidate) => isAbsolutePath(candidate) && exists(candidate));
	if (!found) throw new Error('SUPABASE_BIN must point to the absolute Supabase CLI path.');
	return found;
}
