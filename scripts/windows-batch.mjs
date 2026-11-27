import { execFileSync } from 'node:child_process';
import { win32 } from 'node:path';

const UNSAFE_CHARS = /["%!^&|<>\r\n\0]/;

function assertSafeText(value, label) {
	if (UNSAFE_CHARS.test(value)) {
		throw new Error(`${label} contains a character that cmd.exe could interpret.`);
	}
}

export function assertSafeBatchPath(command) {
	if (typeof command !== 'string' || !win32.isAbsolute(command)) {
		throw new Error('The batch command must be an absolute Windows path.');
	}
	if (/^\\\\/.test(command)) {
		throw new Error('UNC batch paths are not allowed.');
	}
	if (!/\.(cmd|bat)$/i.test(command)) {
		throw new Error('The batch command must end in .cmd or .bat.');
	}
	assertSafeText(command, 'The batch command path');
	return win32.normalize(command);
}

export function quoteBatchArgument(argument) {
	const value = String(argument);
	assertSafeText(value, 'A batch argument');
	return /\s/.test(value) ? `"${value}"` : value;
}

export function buildBatchCommandLine(command, args) {
	const executable = `"${assertSafeBatchPath(command)}"`;
	const quotedArgs = args.map(quoteBatchArgument);
	return `"${[executable, ...quotedArgs].join(' ')}"`;
}

export function resolveWindowsSystem32(name, env = process.env) {
	const systemRoot = env.SystemRoot;
	if (!systemRoot || !/^[a-z]:\\windows\\?$/i.test(win32.normalize(systemRoot))) {
		throw new Error('SystemRoot must point to the local Windows system directory.');
	}
	return win32.join(systemRoot, 'System32', name);
}

export function resolveWindowsCommandShell(env = process.env) {
	return resolveWindowsSystem32('cmd.exe', env);
}

export function runWindowsBatchFile(
	command,
	args = [],
	{
		env = process.env,
		cwd = process.cwd(),
		encoding = 'utf8',
		stdio = ['ignore', 'pipe', 'pipe'],
	} = {},
) {
	return execFileSync(
		resolveWindowsCommandShell(env),
		['/d', '/s', '/c', buildBatchCommandLine(command, args)],
		{
			cwd,
			env,
			encoding,
			stdio,
			windowsVerbatimArguments: true,
		},
	);
}
