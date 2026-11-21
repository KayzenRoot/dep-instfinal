#!/usr/bin/env node
// Applies the additive V2 migrations to the hosted Supabase project through the
// Management API. Dry-run is the default. For execution the owner supplies a PAT
// via env or --token-file and confirms the project ref:
//   SUPABASE_ACCESS_TOKEN="$(cat <private>/supabase-pat.txt)" \
//   SUPABASE_PROJECT_REF=... node scripts/apply-hosted-migrations.mjs \
//     --execute --confirm-project <ref>
// Never prints the token or full SQL responses.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

async function main() {
	const MIGRATION_DIR = 'supabase/migrations';
	const DEFAULT_FROM = '20261112170000';
	const V2_MARKERS = ['video_assets', 'video_edit_plans', 'render_jobs', 'style_presets'];

	function option(name, fallback) {
		const index = process.argv.indexOf(name);
		return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
	}

	const from = option('--from', DEFAULT_FROM);
	const execute = process.argv.includes('--execute');
	const resume = process.argv.includes('--resume');
	const allowV1 = process.argv.includes('--allow-v1');
	const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
	const tokenFile = option('--token-file', '');
	const ledgerPath = option(
		'--ledger',
		join(homedir(), '.dif-studio', `hosted-migrations-${projectRef || 'unknown'}.json`),
	);
	const confirmProject = option('--confirm-project', '');

	if (!/^\d{14}$/.test(from) || !/^[a-z0-9]{20}$/.test(projectRef))
		throw new Error('Use --from YYYYMMDDHHMMSS and SUPABASE_PROJECT_REF (20 lowercase chars).');
	if (from < DEFAULT_FROM && !allowV1)
		throw new Error(
			`--from before ${DEFAULT_FROM} requires --allow-v1 (V1 migrations are not idempotent).`,
		);
	if (!isAbsolute(ledgerPath)) throw new Error('--ledger must be an absolute path.');
	if (tokenFile && !isAbsolute(tokenFile))
		throw new Error('--token-file must be an absolute path.');

	const allFiles = (await readdir(MIGRATION_DIR))
		.filter((file) => file.endsWith('.sql'))
		.sort((left, right) => left.localeCompare(right));
	const files = allFiles.filter((file) => file.slice(0, 14) >= from);
	if (files.length === 0) throw new Error('No migrations selected.');

	async function expectedTableNames() {
		const names = new Set();
		for (const file of allFiles) {
			const sql = await readFile(`${MIGRATION_DIR}/${file}`, 'utf8');
			for (const match of sql.matchAll(/create table(?: if not exists)?\s+public\.(\w+)\s*\(/gi))
				names.add(match[1]);
		}
		return names;
	}

	const expectedTables = await expectedTableNames();
	if (!execute) {
		console.log(
			`Dry run: ${files.length} migrations from ${from} would be applied to ${projectRef}; ${expectedTables.size} public tables expected.`,
		);
		for (const file of files) console.log(`- ${file}`);
		process.exit(0);
	}

	let token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
	if (!token && tokenFile) token = (await readFile(tokenFile, 'utf8')).trim();
	if (!/^sbp_[A-Za-z0-9]+$/.test(token))
		throw new Error('SUPABASE_ACCESS_TOKEN or --token-file must contain an owner PAT (sbp_...).');
	if (confirmProject !== projectRef)
		throw new Error(`Execution requires --confirm-project ${projectRef}.`);

	let ledger = { projectRef, applied: [] };
	if (existsSync(ledgerPath)) {
		try {
			const parsed = JSON.parse(await readFile(ledgerPath, 'utf8'));
			if (parsed?.projectRef !== projectRef || !Array.isArray(parsed?.applied))
				throw new Error('ledger does not belong to this project');
			ledger = parsed;
		} catch {
			throw new Error(`Unreadable migration ledger at ${ledgerPath}; inspect before retrying.`);
		}
	}
	console.log(`Target: ${projectRef}; ${files.length} migrations; ledger: ${ledgerPath}`);

	async function query(sql) {
		let response;
		try {
			response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ query: sql }),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (cause) {
			if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError')
				throw new Error('Management API timed out; inspect the project before retrying.', {
					cause,
				});
			throw cause;
		}
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

	async function writeLedger() {
		await mkdir(join(homedir(), '.dif-studio'), { recursive: true, mode: 0o700 });
		await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
	}

	const before = await query(
		"select tablename from pg_tables where schemaname = 'public' order by tablename",
	);
	if (!Array.isArray(before))
		throw new Error('Management API returned an unexpected table list; refusing to proceed.');
	const present = new Set(before.map((row) => row.tablename));
	const markers = V2_MARKERS.filter((table) => present.has(table));
	if (markers.length > 0) {
		if (!resume || ledger.applied.length === 0)
			throw new Error(
				`V2 schema already present (${markers.join(', ')}); use --resume only with a matching ledger, or inspect manually.`,
			);
		console.log(`Resuming from ledger with ${ledger.applied.length} applied migrations.`);
	}

	for (const file of files) {
		if (ledger.applied.includes(file)) {
			console.log(`SKIP ${file} (ledger)`);
			continue;
		}
		const sql = await readFile(`${MIGRATION_DIR}/${file}`, 'utf8');
		console.log(`Applying ${file}...`);
		await query(sql);
		ledger.applied.push(file);
		await writeLedger();
		console.log(`OK ${file}`);
	}

	const after = await query(
		"select tablename from pg_tables where schemaname = 'public' order by tablename",
	);
	if (!Array.isArray(after))
		throw new Error('Management API returned an unexpected post-apply table list.');
	const actualTables = new Set(after.map((row) => row.tablename));
	const missing = [...expectedTables].filter((table) => !actualTables.has(table));
	const extra = [...actualTables].filter((table) => !expectedTables.has(table));
	if (missing.length || extra.length)
		throw new Error(
			`Schema mismatch: missing=[${missing.join(', ')}], extra=[${extra.join(', ')}].`,
		);
	console.log(`Applied ${files.length} migrations; ${actualTables.size} public tables match.`);
}

main().catch((cause) => {
	console.error(`ERROR ${cause instanceof Error ? cause.message : String(cause)}`);
	process.exitCode = 1;
});
