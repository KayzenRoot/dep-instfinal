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

function assertLocalWindowsPath(command) {
	const normalized = win32.normalize(command);
	if (!/^[a-z]:\\/i.test(normalized)) {
		throw new Error('SUPABASE_BIN on Windows must be a local drive-absolute path.');
	}
	return normalized;
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
		return platform === 'win32' ? assertLocalWindowsPath(configured) : configured;
	}
	const rawCandidates = platform === 'win32' ? windowsCandidates(env) : POSIX_CANDIDATES;
	const candidates =
		platform === 'win32'
			? rawCandidates.map((candidate) => assertLocalWindowsPath(candidate))
			: rawCandidates;
	const found = candidates.find((candidate) => isAbsolutePath(candidate) && exists(candidate));
	if (!found) throw new Error('SUPABASE_BIN must point to the absolute Supabase CLI path.');
	return found;
}

function resolveNpmSupabaseEntry(command, exists) {
	const entry = assertLocalWindowsPath(
		win32.join(win32.dirname(command), 'node_modules', 'supabase', 'dist', 'supabase.js'),
	);
	return exists(entry) ? entry : undefined;
}

export function resolveSupabaseInvocation({
	env = process.env,
	platform = process.platform,
	exists = existsSync,
	nodeExecutable = process.execPath,
} = {}) {
	const command = resolveSupabaseCommand({ env, platform, exists });
	if (platform !== 'win32' || /\.exe$/i.test(command)) {
		return { command, args: [], kind: 'native' };
	}
	if (!/\.(cmd|bat)$/i.test(command)) {
		throw new Error('SUPABASE_BIN on Windows must be an .exe, .cmd or .bat path.');
	}
	const entry = resolveNpmSupabaseEntry(command, exists);
	if (!entry) {
		throw new Error(
			'The Supabase .cmd shim has no local dist/supabase.js; set SUPABASE_BIN to a native .exe.',
		);
	}
	return {
		command: nodeExecutable,
		args: [entry],
		kind: 'node-script',
	};
}
