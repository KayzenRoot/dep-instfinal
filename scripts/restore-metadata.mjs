#!/usr/bin/env node
// Restores a metadata backup into a disposable local database and verifies
// counts, owner links and artifact hashes. Never touches the source database.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	createReadStream,
	existsSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const backupDir = resolve(option('--backup-dir', ''));
if (!backupDir || !existsSync(join(backupDir, 'summary.json')))
	throw new Error('Use --backup-dir with a summary.json produced by backup-metadata.mjs.');
const database = option('--database', 'dif_restore_test');
if (!/^dif_restore_test[a-z0-9_]{0,48}$/.test(database))
	throw new Error('Refusing to restore into a non-disposable database name.');
const container = option('--container', 'supabase_db_dif-studio-local');
const dockerBin = process.env.DOCKER_BIN;
if (!dockerBin || !isAbsolute(dockerBin))
	throw new Error('Set DOCKER_BIN to an absolute Docker CLI path (no PATH lookup).');
if (!/^supabase_db_[a-z0-9_-]{1,64}$/.test(container))
	throw new Error('Refusing an unexpected Docker container name.');
const summary = JSON.parse(readFileSync(join(backupDir, 'summary.json'), 'utf8'));
const allowedTables = new Set([
	'series',
	'seasons',
	'episodes',
	'scenes',
	'choices',
	'polls',
	'poll_results',
	'canonical_decisions',
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
]);
for (const table of Object.keys(summary.counts)) {
	if (!allowedTables.has(table) || !/^[a-z][a-z0-9_]{0,63}$/.test(table))
		throw new Error(`Unexpected backup table: ${table}`);
}
const schemaBytes = readFileSync(join(backupDir, 'schema.sql'));
const dataBytes = readFileSync(join(backupDir, 'data.sql'));
const schemaSha = createHash('sha256').update(schemaBytes).digest('hex');
const dataSha = createHash('sha256').update(dataBytes).digest('hex');
if (schemaSha !== summary.files?.schema?.sha256 || dataSha !== summary.files?.data?.sha256)
	throw new Error('Backup SHA-256 mismatch; refusing to restore a corrupted or altered dump.');
const schemaSql = schemaBytes.toString('utf8');
const dataSql = dataBytes.toString('utf8');

function psql(target, args, input) {
	return execFileSync(
		dockerBin,
		['exec', '-i', container, 'psql', '-U', 'postgres', '-d', target, ...args],
		{
			input,
			encoding: 'utf8',
			stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		},
	);
}

psql('postgres', [
	'-v',
	'ON_ERROR_STOP=1',
	'-c',
	`drop database if exists ${database};`,
	'-c',
	`create database ${database};`,
]);
psql(database, [
	'-v',
	'ON_ERROR_STOP=1',
	'-c',
	`create schema if not exists auth;
		 create schema if not exists extensions;
		 create extension if not exists pgcrypto with schema extensions;
		 create or replace function auth.uid() returns uuid language sql stable as $$
		   select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
		 $$;
		 create or replace function auth.jwt() returns jsonb language sql stable as $$
		   select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
		 $$;`,
]);
psql(database, ['-v', 'ON_ERROR_STOP=1', '-f', '-'], schemaSql);
psql(database, ['-v', 'ON_ERROR_STOP=1', '-f', '-'], dataSql);

const tables = Object.keys(summary.counts);
const countSql = tables
	.map((table) => `select '${table}', count(*) from public.${table}`)
	.join(' union all ');
const countOutput = psql(database, ['-tA', '-c', countSql]);
const restoredCounts = Object.fromEntries(
	countOutput
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [table, count] = line.split('|');
			return [table, Number(count)];
		}),
);
const countMismatches = tables.filter((table) => restoredCounts[table] !== summary.counts[table]);

const joinCheck = psql(database, [
	'-tA',
	'-c',
	`select count(*)
	 from public.episodes e
	 join public.seasons se on se.id = e.season_id and se.owner_id = e.owner_id
	 join public.series sr on sr.id = se.series_id and sr.owner_id = se.owner_id
	 join public.scenes sc on sc.episode_id = e.id and sc.owner_id = e.owner_id`,
]).trim();
const hashCheck = psql(database, [
	'-tA',
	'-c',
	`select count(*)
	 from public.render_jobs j
	 join public.render_quality_reports q
	   on q.job_id = j.id and q.owner_id = j.owner_id
	 where j.status = 'READY'
	   and j.output_manifest ->> 'sha256' = q.artifact_sha256`,
]).trim();

const artifacts = [];
for (const artifact of summary.artifacts) {
	if (artifact.bucket !== 'local-test' || !artifact.objectKey) {
		artifacts.push({ ...artifact, blob: 'unverified_r2' });
		continue;
	}
	const displayPath = String(artifact.objectKey).replaceAll('\\', '/');
	if (!existsSync(artifact.objectKey)) {
		artifacts.push({ ...artifact, objectKey: displayPath, blob: 'missing' });
		continue;
	}
	const sizeMatches =
		typeof artifact.byteSize === 'number'
			? statSync(artifact.objectKey).size === artifact.byteSize
			: true;
	if (!sizeMatches) {
		artifacts.push({ ...artifact, objectKey: displayPath, blob: 'size_mismatch' });
		continue;
	}
	const hash = createHash('sha256');
	const source = createReadStream(artifact.objectKey);
	for await (const chunk of source) hash.update(chunk);
	artifacts.push({
		...artifact,
		objectKey: displayPath,
		blob: hash.digest('hex') === artifact.sha256 ? 'verified_local' : 'hash_mismatch',
	});
}

const expectedQa = summary.artifacts.filter((artifact) =>
	summary.qualityReports.some(
		(report) => report.job_id === artifact.jobId && report.artifact_sha256 === artifact.sha256,
	),
).length;
const metadataOk =
	countMismatches.length === 0 && Number(joinCheck) > 0 && Number(hashCheck) === expectedQa;
const mediaOk = artifacts.every((artifact) => artifact.blob === 'verified_local');
const report = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	backupDir,
	database,
	shaVerified: true,
	countMismatches,
	episodeSceneJoinRows: Number(joinCheck),
	expectedReadyJobsWithQa: expectedQa,
	readyJobsWithMatchingQaHash: Number(hashCheck),
	metadataOk,
	mediaOk,
	artifacts,
	ok: metadataOk && mediaOk,
};
const reportPath = join(backupDir, 'restore-report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
chmodSync(reportPath, 0o600);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
