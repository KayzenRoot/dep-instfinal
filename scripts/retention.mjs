#!/usr/bin/env node
// Dry-run-first retention for local render artifacts. R2 lifecycle/GC stays
// manual until the bucket-scoped token gets lifecycle permission (WO-013 note).
import { execFileSync } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function parseEnvironment(output) {
	return Object.fromEntries(
		output
			.split(/\r?\n/)
			.map((line) => line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/))
			.filter(Boolean)
			.map(([, name, raw]) => {
				const value = raw.trim();
				return [name, value.startsWith('"') ? JSON.parse(value) : value.replace(/^'|'$/g, '')];
			}),
	);
}

function supabaseEnvironment() {
	if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
		return {
			url: process.env.SUPABASE_URL,
			key: process.env.SUPABASE_SERVICE_ROLE_KEY,
		};
	const output =
		process.platform === 'win32'
			? execFileSync(
					process.env.ComSpec ?? 'cmd.exe',
					['/d', '/s', '/c', 'supabase status --output env'],
					{
						encoding: 'utf8',
						stdio: ['ignore', 'pipe', 'pipe'],
					},
				)
			: execFileSync('supabase', ['status', '--output', 'env'], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				});
	const env = parseEnvironment(output);
	if (!env.API_URL || !env.SERVICE_ROLE_KEY)
		throw new Error('Supabase API_URL/SERVICE_ROLE_KEY missing.');
	return { url: env.API_URL, key: env.SERVICE_ROLE_KEY };
}

function argumentsFrom(argv) {
	const options = {
		localDir: process.env.WORKER_LOCAL_OUTPUT_DIR ?? '',
		minAgeHours: 24,
		deleteLocal: false,
		confirm: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === '--local-dir') options.localDir = argv[++index] ?? '';
		else if (value === '--min-age-hours') options.minAgeHours = Number(argv[++index] ?? 24);
		else if (value === '--delete-local') options.deleteLocal = true;
		else if (value === '--confirm') options.confirm = true;
	}
	return options;
}

const options = argumentsFrom(process.argv.slice(2));
const { url, key } = supabaseEnvironment();
const client = createClient(url, key, {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const { data: jobs, error: jobsError } = await client
	.from('render_jobs')
	.select('id,status,output_manifest,created_at')
	.order('created_at', { ascending: false })
	.limit(1000);
if (jobsError) throw new Error(`render_jobs: ${jobsError.message}`);

const referenced = new Set();
const missingReferenced = [];
for (const job of jobs ?? []) {
	const manifest = job.output_manifest;
	if (!manifest || typeof manifest !== 'object') continue;
	if (manifest.bucket !== 'local-test' || typeof manifest.objectKey !== 'string') continue;
	const path = resolve(manifest.objectKey);
	referenced.add(path);
	const information = await stat(path).catch(() => null);
	if (!information || !information.isFile()) missingReferenced.push({ jobId: job.id, path });
	else if (typeof manifest.byteSize === 'number' && information.size !== manifest.byteSize)
		missingReferenced.push({ jobId: job.id, path, reason: 'size_mismatch' });
}

const activeJobs = (jobs ?? []).filter((job) =>
	['QUEUED', 'CLAIMED', 'RUNNING'].includes(job.status),
);

const localFiles = [];
if (options.localDir) {
	const entries = await readdir(options.localDir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.mp4')) continue;
		const path = resolve(options.localDir, entry.name);
		const information = await stat(path).catch(() => null);
		if (!information) continue;
		localFiles.push({
			path,
			byteSize: information.size,
			modifiedAt: information.mtime.toISOString(),
			referenced: referenced.has(path),
		});
	}
}

const now = Date.now();
const minAgeMs = Math.max(0, options.minAgeHours) * 60 * 60 * 1000;
const candidates = localFiles.filter(
	(file) => !file.referenced && now - new Date(file.modifiedAt).getTime() >= minAgeMs,
);

let deleted = [];
if (options.deleteLocal) {
	if (!options.confirm) throw new Error('--delete-local requires --confirm.');
	if (activeJobs.length) throw new Error('Refusing to delete while render jobs are active.');
	for (const file of candidates) {
		await unlink(file.path);
		deleted.push(file.path);
	}
}

const summary = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	dryRun: !options.deleteLocal,
	localDir: options.localDir || null,
	minAgeHours: options.minAgeHours,
	referencedLocalArtifacts: referenced.size,
	missingReferenced,
	activeJobs: activeJobs.map((job) => job.id),
	localFiles: localFiles.length,
	unreferencedFiles: localFiles.filter((file) => !file.referenced).length,
	candidates,
	deleted,
	r2: {
		status: 'manual',
		reason:
			'Bucket-scoped token cannot manage lifecycle; use provider dashboard or a scoped admin token.',
	},
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
