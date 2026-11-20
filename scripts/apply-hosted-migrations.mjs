#!/usr/bin/env node
// Applies the additive V2 migrations to the hosted Supabase project through the
// Management API. Dry-run is the default. Requires an owner-provided PAT:
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
//     node scripts/apply-hosted-migrations.mjs --execute
// Never prints the token or full SQL responses.
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';

const MIGRATION_DIR = 'supabase/migrations';
const DEFAULT_FROM = '20261112170000';
const V2_MARKERS = ['video_assets', 'video_edit_plans', 'render_jobs', 'style_presets'];

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const from = option('--from', DEFAULT_FROM);
const execute = process.argv.includes('--execute');
const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const expectedTables = Number(option('--expect-tables', '41'));

if (!/^\d{14}$/.test(from) || !/^[a-z0-9]{20}$/.test(projectRef))
	throw new Error('Use --from YYYYMMDDHHMMSS and SUPABASE_PROJECT_REF (20 lowercase chars).');
if (!Number.isInteger(expectedTables) || expectedTables < 1 || expectedTables > 500)
	throw new Error('Invalid --expect-tables.');

const files = (await readdir(MIGRATION_DIR))
	.filter((file) => file.endsWith('.sql') && file.slice(0, 14) >= from)
	.sort((left, right) => left.localeCompare(right));
if (files.length === 0) throw new Error('No migrations selected.');
if (!execute) {
	console.log(`Dry run: ${files.length} migrations from ${from} would be applied.`);
	for (const file of files) console.log(`- ${file}`);
	process.exit(0);
}
if (!/^sbp_[A-Za-z0-9]+$/.test(token))
	throw new Error('SUPABASE_ACCESS_TOKEN must be an owner PAT (sbp_...).');

async function query(sql) {
	const response = await fetch(
		`https://api.supabase.com/v1/projects/${projectRef}/database/query`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ query: sql }),
		},
	);
	const text = await response.text();
	if (!response.ok)
		throw new Error(
			`Management API HTTP ${response.status}: ${text.slice(0, 300).replaceAll(/\s+/g, ' ')}`,
		);
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const before = await query(
	"select tablename from pg_tables where schemaname = 'public' order by tablename",
);
const present = new Set((Array.isArray(before) ? before : []).map((row) => row.tablename));
const markers = V2_MARKERS.filter((table) => present.has(table));
if (markers.length > 0)
	throw new Error(
		`V2 schema already present (${markers.join(', ')}); refusing to reapply. Inspect the project before using --from.`,
	);

for (const file of files) {
	const sql = await readFile(`${MIGRATION_DIR}/${file}`, 'utf8');
	console.log(`Applying ${file}...`);
	await query(sql);
	console.log(`OK ${file}`);
}

const after = await query(
	"select count(*)::int as count from pg_tables where schemaname = 'public'",
);
const count = Array.isArray(after) ? Number(after[0]?.count) : Number.NaN;
if (count !== expectedTables)
	throw new Error(`Expected ${expectedTables} public tables after migrations, found ${count}.`);
console.log(`Applied ${files.length} migrations; ${count} public tables.`);
