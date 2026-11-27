import {
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';
import { hardenWindowsPrivatePath } from './windows-acl.mjs';

function pathApi(platform) {
	return platform === 'win32' ? win32 : posix;
}

function isWithin(parent, child, platform) {
	const path = pathApi(platform);
	const relativePath = path.relative(path.resolve(parent), path.resolve(child));
	return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function currentUid() {
	return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function assertOwnedByCurrentUser(stat, platform, label) {
	if (platform === 'win32') return;
	const uid = currentUid();
	if (uid !== undefined && stat.uid !== uid) {
		throw new Error(`${label} must be owned by the current user.`);
	}
}

function assertPrivateDirectory(dir, platform) {
	const stat = lstatSync(dir);
	if (stat.isSymbolicLink()) throw new Error('Worker log directory must not be a symbolic link.');
	if (!stat.isDirectory()) throw new Error('Worker log directory must be a directory.');
	assertOwnedByCurrentUser(stat, platform, 'Worker log directory');
	if (platform !== 'win32') {
		chmodSync(dir, 0o700);
		const after = lstatSync(dir);
		if ((after.mode & 0o077) !== 0) {
			throw new Error('Worker log directory must not be accessible by group or others.');
		}
	}
}

function assertExistingFile(path, platform) {
	let stat;
	try {
		stat = lstatSync(path);
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	if (stat.isSymbolicLink()) throw new Error('Worker log file must not be a symbolic link.');
	if (!stat.isFile()) throw new Error('Worker log file must be a regular file.');
	assertOwnedByCurrentUser(stat, platform, 'Worker log file');
	if (platform !== 'win32' && stat.nlink > 1) {
		throw new Error('Worker log file must not be a hard link.');
	}
}

function assertNoSymlinkTrail(dir, platform, base) {
	if (!base) return;
	const path = pathApi(platform);
	const relativePath = path.relative(path.resolve(base), path.resolve(dir));
	if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
	let current = path.resolve(base);
	for (const segment of relativePath.split(path.sep)) {
		current = path.join(current, segment);
		let stat;
		try {
			stat = lstatSync(current);
		} catch (error) {
			if (error.code === 'ENOENT') return;
			throw error;
		}
		if (stat.isSymbolicLink()) {
			throw new Error('Worker log path must not traverse a symbolic link.');
		}
	}
}

function openPrivateFile(path, flags, platform) {
	assertPrivateDirectory(dirname(path), platform);
	assertExistingFile(path, platform);
	const noFollow = platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
	const fd = openSync(path, flags | noFollow, 0o600);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new Error('Worker log file must be a regular file.');
		assertOwnedByCurrentUser(stat, platform, 'Worker log file');
		if (platform !== 'win32') {
			fchmodSync(fd, 0o600);
			const after = fstatSync(fd);
			if ((after.mode & 0o077) !== 0) {
				throw new Error('Worker log file must not be accessible by group or others.');
			}
		} else {
			hardenWindowsPrivatePath(path, { env: process.env });
		}
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

export function resolveWorkerLogDir({
	env = process.env,
	homeDir = homedir(),
	platform = process.platform,
} = {}) {
	const path = pathApi(platform);
	const configured = env.DIF_WORKER_LOG_DIR?.trim();
	if (configured) {
		if (!path.isAbsolute(configured))
			throw new Error('DIF_WORKER_LOG_DIR must be an absolute path.');
		if (!isWithin(homeDir, configured, platform)) {
			throw new Error(
				platform === 'win32'
					? 'DIF_WORKER_LOG_DIR on Windows must be under the user profile.'
					: 'DIF_WORKER_LOG_DIR must be under the user home directory.',
			);
		}
		return path.normalize(configured);
	}
	return path.join(homeDir, '.zcode', 'dif-secrets', 'worker-logs');
}

export function prepareWorkerLogDir(options = {}) {
	const platform = options.platform ?? process.platform;
	const homeDir = options.homeDir ?? homedir();
	const dir = resolveWorkerLogDir({ ...options, homeDir });
	assertNoSymlinkTrail(dir, platform, homeDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	assertNoSymlinkTrail(dir, platform, homeDir);
	assertPrivateDirectory(dir, platform);
	if (platform === 'win32') hardenWindowsPrivatePath(dir, { directory: true, env: process.env });
	return dir;
}

export function prepareWorkerLogFile(path, { platform = process.platform } = {}) {
	const fd = openPrivateFile(
		path,
		constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
		platform,
	);
	closeSync(fd);
	return path;
}

export function writeWorkerLock(path, pid, { platform = process.platform } = {}) {
	const fd = openPrivateFile(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
		platform,
	);
	try {
		writeSync(fd, String(pid));
	} finally {
		closeSync(fd);
	}
	return path;
}

export function readWorkerLock(path, { platform = process.platform } = {}) {
	const fd = openPrivateFile(path, constants.O_RDWR | constants.O_CREAT, platform);
	try {
		return readFileSync(fd, 'utf8');
	} finally {
		closeSync(fd);
	}
}
