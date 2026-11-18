#!/usr/bin/env node
// Dry-run-first retention for local render artifacts. R2 lifecycle/GC stays
// manual until the bucket-scoped token gets lifecycle permission (WO-013 note).
import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function supabaseEnvironment() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (no PATH lookup).');
	return { url, key };
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
if (options.localDir) {
	const resolved = resolve(options.localDir);
	if (!/dif/i.test(resolved) || resolved.length <= 3)
		throw new Error('Refusing an unsafe --local-dir; use a DIF render directory.');
}
const { url, key } = supabaseEnvironment();
const client = createClient(url, key, {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const jobs = [];
for (let from = 0; ; from += 1_000) {
	const { data, error } = await client
		.from('render_jobs')
		.select('id,status,output_manifest,created_at')
		.order('created_at', { ascending: false })
		.range(from, from + 999);
	if (error) throw new Error(`render_jobs: ${error.message}`);
	jobs.push(...(data ?? []));
	if (!data || data.length < 1_000) break;
}

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
