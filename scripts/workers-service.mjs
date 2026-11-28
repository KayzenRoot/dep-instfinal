#!/usr/bin/env node
// Keeps the media validator and render worker alive as one supervised process.
// Run through Windows Task Scheduler with:
//   node --env-file=<repo>/.env --env-file=<private>/r2.env scripts/workers-service.mjs
import { spawn, spawnSync } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	lstatSync,
	renameSync,
	statSync,
	unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import {
	prepareWorkerLogDir,
	prepareWorkerLogFile,
	readWorkerLock,
	writeWorkerLock,
} from './worker-log-dir.mjs';
import { resolveTaskkillPath } from './taskkill-path.mjs';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logDir = prepareWorkerLogDir();
const lockPath = join(logDir, 'workers-service.lock');

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

if (existsSync(lockPath)) {
	const owner = Number.parseInt(readWorkerLock(lockPath), 10);
	if (Number.isInteger(owner) && owner > 0 && owner !== process.pid && isAlive(owner)) {
		console.error(JSON.stringify({ event: 'supervisor_already_running', pid: owner }));
		process.exit(0);
	}
}
writeWorkerLock(lockPath, process.pid);

function openLog(name) {
	const path = join(logDir, `${name}.log`);
	prepareWorkerLogFile(path);
	if (statSync(path).size > 10 * 1024 * 1024) {
		const rotated = `${path}.1`;
		try {
			const rotatedStat = lstatSync(rotated);
			if (rotatedStat.isDirectory()) {
				throw new Error(`Rotated log path is a directory: ${rotated}`);
			}
			unlinkSync(rotated);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		renameSync(path, rotated);
		prepareWorkerLogFile(rotated);
	}
	prepareWorkerLogFile(path);
	return createWriteStream(path, { flags: 'a' });
}

const supervisorLog = openLog('supervisor');
function log(event, fields = {}) {
	const line = JSON.stringify({ event, at: new Date().toISOString(), ...fields });
	supervisorLog.write(`${line}\n`);
	console.log(line);
}

const children = new Map();
let stopping = false;

function killTree(child) {
	if (!child?.pid) return;
	if (process.platform === 'win32') {
		spawnSync(resolveTaskkillPath(), ['/PID', String(child.pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true,
		});
	} else {
		try {
			child.kill('SIGTERM');
		} catch {
			// already gone
		}
	}
}

function startChild(name, args, logName) {
	if (stopping) return;
	const logStream = openLog(logName);
	let retryMs = 1_000;
	const spawnChild = () => {
		if (stopping) return;
		const child = spawn(process.execPath, args, {
			cwd: root,
			env: {
				...process.env,
				WORKER_ID: `${name}-service`,
				WORKER_MAX_JOBS: '0',
				WORKER_POLL_MS: '1000',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		children.set(name, child);
		log(`${name}_started`, { pid: child.pid });
		child.stdout?.on('data', (chunk) => logStream.write(chunk));
		child.stderr?.on('data', (chunk) => logStream.write(chunk));
		const startedAt = Date.now();
		child.on('error', (cause) =>
			log(`${name}_spawn_error`, { message: String(cause).slice(0, 200) }),
		);
		child.on('exit', (code, signal) => {
			children.delete(name);
			const uptimeMs = Date.now() - startedAt;
			log(`${name}_exited`, { code, signal, uptimeMs });
			if (stopping) return;
			const delay = uptimeMs > 60_000 ? 1_000 : retryMs;
			retryMs = Math.min(60_000, delay * 2);
			log(`${name}_restart_scheduled`, { delayMs: delay });
			setTimeout(spawnChild, delay);
		});
	};
	spawnChild();
}

startChild(
	'media',
	[
		join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
		join(root, 'scripts', 'media-validator.ts'),
	],
	'media',
);
startChild('render', [join(root, 'scripts', 'render-worker.mjs')], 'render');

log('supervisor_started', { pid: process.pid, root });

function shutdown(signal) {
	if (stopping) return;
	stopping = true;
	log('supervisor_stopping', { signal });
	for (const child of children.values()) killTree(child);
	try {
		unlinkSync(lockPath);
	} catch {
		// already removed
	}
	supervisorLog.end();
	setTimeout(() => process.exit(0), 800);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => shutdown(signal));
}
process.on('uncaughtException', (cause) => {
	log('supervisor_uncaught', { message: String(cause).slice(0, 300) });
	shutdown('uncaughtException');
});
