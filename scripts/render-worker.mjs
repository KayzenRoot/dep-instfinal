import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url =
	process.env.WORKER_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.WORKER_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
	console.error(
		JSON.stringify({ event: 'worker_config_error', message: 'Supabase worker URL/key missing' }),
	);
	process.exit(1);
}
const stub = process.env.WORKER_STUB !== '0';

const workerId = (process.env.WORKER_ID ?? `worker-${hostname()}-${process.pid}`).slice(0, 80);
const pollMs = Math.max(250, Math.min(30_000, Number(process.env.WORKER_POLL_MS ?? 1_000)));
const leaseSeconds = Math.max(15, Math.min(600, Number(process.env.WORKER_LEASE_SECONDS ?? 60)));
const maxJobs = Math.max(0, Math.min(1_000, Number(process.env.WORKER_MAX_JOBS ?? 0)));
const client = createClient(url, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

let stopping = false;
let activeAbort = null;
let activeChild = null;
let jobsRun = 0;

function log(event, fields = {}) {
	console.log(JSON.stringify({ event, workerId, ...fields }));
}

function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function stopChild(child) {
	if (!child?.pid) return;
	if (process.platform === 'win32') {
		const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
		spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true,
		});
	} else {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			child.kill('SIGTERM');
		}
	}
}

async function runRealRender(job, signal) {
	const cli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const child = spawn(process.execPath, [cli, 'scripts/render-job.ts'], {
		env: { ...process.env, RENDER_JOB_ID: job.id },
		detached: process.platform !== 'win32',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	activeChild = child;
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
	child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
	const abort = () => stopChild(child);
	signal.addEventListener('abort', abort, { once: true });
	try {
		const code = await new Promise((resolve) => child.on('exit', (value) => resolve(value ?? 1)));
		if (code !== 0) throw new Error(stderr.trim().slice(0, 64) || 'WORKER_RENDER_FAILED');
		const lines = stdout.trim().split(String.fromCharCode(10));
		const lastLine = lines[lines.length - 1];
		if (!lastLine) throw new Error('WORKER_RENDER_FAILED');
		return JSON.parse(lastLine);
	} finally {
		signal.removeEventListener('abort', abort);
		activeChild = null;
	}
}

async function rpc(name, args) {
	const { data, error } = await client.rpc(name, args);
	if (error) throw new Error(`${name}: ${error.message}`);
	return data;
}

async function jobStatus(jobId) {
	const { data, error } = await client
		.from('render_jobs')
		.select('status')
		.eq('id', jobId)
		.maybeSingle();
	if (error) throw new Error(`job status: ${error.message}`);
	return data?.status ?? null;
}

async function runJob(job) {
	const abort = new AbortController();
	activeAbort = abort;
	let heartbeatError = null;
	const heartbeat = setInterval(
		() => {
			void rpc('heartbeat_render_job', {
				p_job_id: job.id,
				p_worker_id: workerId,
				p_lease_seconds: leaseSeconds,
			}).catch(() => {
				heartbeatError = new Error('heartbeat failed');
				abort.abort();
			});
		},
		Math.max(1_000, Math.floor((leaseSeconds * 1000) / 3)),
	);
	try {
		await rpc('start_render_job', { p_job_id: job.id, p_worker_id: workerId });
		log('render_started', { jobId: job.id, planVersion: job.plan_version, stub });
		let outputManifest;
		if (stub) {
			await sleep(250, abort.signal);
			if (abort.signal.aborted) {
				throw new Error(stopping ? 'WORKER_SHUTDOWN' : 'WORKER_LEASE_LOST');
			}
			const status = await jobStatus(job.id);
			if (status === 'CANCELED') throw new Error('WORKER_CANCELED');
			if (status !== 'RUNNING') throw new Error('WORKER_LEASE_LOST');
			outputManifest = {
				schemaVersion: 1,
				jobId: job.id,
				planId: job.plan_id,
				planVersion: job.plan_version,
				stub: true,
				completedAt: new Date().toISOString(),
			};
		} else {
			outputManifest = await runRealRender(job, abort.signal);
		}
		await rpc('complete_render_job', {
			p_job_id: job.id,
			p_worker_id: workerId,
			p_output_manifest: outputManifest,
		});
		log('render_completed', { jobId: job.id });
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'WORKER_STUB_FAILED';
		const code = /WORKER_[A-Z_]+/.exec(message)?.[0] ?? 'WORKER_STUB_FAILED';
		try {
			await rpc('fail_render_job', {
				p_job_id: job.id,
				p_worker_id: workerId,
				p_error_code: code.slice(0, 64),
			});
		} catch {
			// A lost lease or canceled job is already reconciled by the queue.
		}
		log('render_failed', { jobId: job.id, code, heartbeatError: Boolean(heartbeatError) });
	} finally {
		clearInterval(heartbeat);
		if (activeChild) stopChild(activeChild);
		activeAbort = null;
	}
}

async function main() {
	log('worker_started', { pollMs, leaseSeconds, maxJobs, stub });
	while (!stopping && (maxJobs === 0 || jobsRun < maxJobs)) {
		try {
			await rpc('reconcile_render_jobs');
			const job = await rpc('claim_render_job', {
				p_worker_id: workerId,
				p_lease_seconds: leaseSeconds,
			});
			if (!job) {
				await sleep(pollMs);
				continue;
			}
			await runJob(job);
			jobsRun += 1;
		} catch (cause) {
			log('worker_error', {
				message: cause instanceof Error ? cause.message.slice(0, 160) : 'unknown',
			});
			await sleep(Math.min(10_000, pollMs * 2));
		}
	}
	log('worker_stopped', { jobsRun });
}

function stop(signal) {
	if (stopping) return;
	stopping = true;
	log('worker_stop_requested', { signal });
	activeAbort?.abort();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

main().catch((cause) => {
	log('worker_fatal', {
		message: cause instanceof Error ? cause.message.slice(0, 160) : 'unknown',
	});
	process.exitCode = 1;
});
