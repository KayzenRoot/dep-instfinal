#!/usr/bin/env node
// Restores a metadata backup into a disposable local database and verifies
// counts, owner links and artifact hashes. Never touches the source database.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const backupDir = resolve(option('--backup-dir', ''));
if (!backupDir || !existsSync(join(backupDir, 'summary.json')))
	throw new Error('Use --backup-dir with a summary.json produced by backup-metadata.mjs.');
const database = option('--database', 'dif_restore_test');
if (!database.startsWith('dif_restore_test'))
	throw new Error('Refusing to restore into a non-disposable database name.');
const container = option('--container', 'supabase_db_dif-studio-local');
const summary = JSON.parse(readFileSync(join(backupDir, 'summary.json'), 'utf8'));

function psql(target, args, input) {
	return execFileSync(
		'docker',
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
psql(database, ['-v', 'ON_ERROR_STOP=1', '-f', '-'], readFileSync(join(backupDir, 'schema.sql')));
psql(database, ['-v', 'ON_ERROR_STOP=1', '-f', '-'], readFileSync(join(backupDir, 'data.sql')));

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

const artifacts = summary.artifacts.map((artifact) => {
	if (artifact.bucket !== 'local-test' || !artifact.objectKey)
		return { ...artifact, blob: 'unverified_r2' };
	const displayPath = String(artifact.objectKey).replaceAll('\\', '/');
	const exists = existsSync(artifact.objectKey);
	const sizeMatches =
		exists && typeof artifact.byteSize === 'number'
			? statSync(artifact.objectKey).size === artifact.byteSize
			: null;
	return {
		...artifact,
		objectKey: displayPath,
		blob: exists ? (sizeMatches ? 'verified_local' : 'size_mismatch') : 'missing',
	};
});

const report = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	backupDir,
	database,
	countMismatches,
	episodeSceneJoinRows: Number(joinCheck),
	readyJobsWithMatchingQaHash: Number(hashCheck),
	artifacts,
	ok: countMismatches.length === 0 && Number(joinCheck) > 0 && Number(hashCheck) >= 0,
};
writeFileSync(
	join(backupDir, 'restore-report.json'),
	`${JSON.stringify(report, null, 2)}\n`,
	'utf8',
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
