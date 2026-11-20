#!/usr/bin/env node
// Metadata backup for the local Supabase stack. Data-only SQL keeps the file
// portable via psql/--use-copy; no video bytes or service keys are included.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function supabaseEnvironment() {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key)
		throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (no PATH lookup).');
	return { url, key };
}

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outDir = resolve(
	option('--out-dir', join(homedir(), '.dif-studio', 'backups', `dif-backup-${timestamp}`)),
);
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const schemaPath = join(outDir, 'schema.sql');
const dataPath = join(outDir, 'data.sql');

const supabaseCli = process.env.SUPABASE_CLI_JS;
if (!supabaseCli || !isAbsolute(supabaseCli))
	throw new Error('Set SUPABASE_CLI_JS to an absolute Supabase CLI JS path (no PATH lookup).');

function runSupabase(args) {
	execFileSync(process.execPath, [supabaseCli, ...args], {
		stdio: ['ignore', 'inherit', 'inherit'],
	});
}
runSupabase(['db', 'dump', '--local', '--schema', 'public', '-f', schemaPath]);
runSupabase([
	'db',
	'dump',
	'--local',
	'--data-only',
	'--schema',
	'public',
	'--use-copy',
	'-f',
	dataPath,
]);
chmodSync(schemaPath, 0o600);
chmodSync(dataPath, 0o600);

const schema = readFileSync(schemaPath);
const data = readFileSync(dataPath);
const { url, key } = supabaseEnvironment();
const client = createClient(url, key, {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const tableNames = [
	'series',
	'seasons',
	'characters',
	'lore_facts',
	'episodes',
	'episode_revisions',
	'scenes',
	'choices',
	'polls',
	'poll_results',
	'canonical_decisions',
	'media_assets',
	'image_references',
	'generation_jobs',
	'video_upload_sessions',
	'video_assets',
	'video_edit_plans',
	'video_edit_plan_versions',
	'render_jobs',
	'render_job_events',
	'voice_direction_plans',
	'narration_takes',
	'caption_tracks',
	'audio_assets',
	'render_quality_reports',
	'hook_variants',
	'character_identity_profiles',
	'character_identity_profile_versions',
	'visual_continuity_reports',
	'cover_revisions',
	'choice_end_cards',
	'published_posts',
	'published_post_versions',
	'creative_variants',
	'retention_imports',
	'analytics_snapshots',
	'retention_experiments',
	'style_presets',
	'style_preset_revisions',
	'episode_style_overrides',
	'scene_style_overrides',
];
const counts = {};
for (const table of tableNames) {
	const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
	if (error) throw new Error(`${table}: ${error.message}`);
	counts[table] = count ?? 0;
}
async function fetchAll(table, select, filter) {
	const rows = [];
	for (let from = 0; ; from += 1_000) {
		let query = client
			.from(table)
			.select(select)
			.order('id', { ascending: true })
			.range(from, from + 999);
		if (filter) query = filter(query);
		const { data, error } = await query;
		if (error) throw new Error(`${table}: ${error.message}`);
		rows.push(...(data ?? []));
		if (!data || data.length < 1_000) break;
	}
	const seen = new Set(rows.map((row) => row.id));
	if (seen.size !== rows.length) throw new Error(`${table}: pagination returned duplicate ids.`);
	let countQuery = client.from(table).select('*', { count: 'exact', head: true });
	if (filter) countQuery = filter(countQuery);
	const { count, error: countError } = await countQuery;
	if (countError || count !== rows.length)
		throw new Error(`${table}: pagination incomplete (${rows.length}/${count ?? '?'}).`);
	return rows;
}
const jobs = await fetchAll('render_jobs', 'id,status,output_manifest', (query) =>
	query.eq('status', 'READY'),
);
const artifacts = jobs
	.map((job) => {
		const manifest = job.output_manifest;
		if (!manifest || typeof manifest !== 'object') return null;
		return {
			jobId: job.id,
			bucket: manifest.bucket ?? null,
			objectKey: manifest.objectKey ?? null,
			sha256: manifest.sha256 ?? null,
			byteSize: manifest.byteSize ?? null,
		};
	})
	.filter(Boolean);
const reports = await fetchAll('render_quality_reports', 'id,job_id,artifact_sha256,status');

const summary = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	files: {
		schema: {
			path: schemaPath,
			bytes: schema.byteLength,
			sha256: createHash('sha256').update(schema).digest('hex'),
		},
		data: {
			path: dataPath,
			bytes: data.byteLength,
			sha256: createHash('sha256').update(data).digest('hex'),
		},
	},
	counts,
	paginationComplete: true,
	artifacts,
	readyJobsWithoutArtifact: jobs.length - artifacts.length,
	qualityReports: reports ?? [],
	redaction: 'public schema only; auth users/secrets and media bytes are not included',
};
const summaryPath = join(outDir, 'summary.json');
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
chmodSync(summaryPath, 0o600);
process.stdout.write(
	`${JSON.stringify({ ok: true, outDir, schemaSha256: summary.files.schema.sha256, dataSha256: summary.files.data.sha256, counts }, null, 2)}\n`,
);
