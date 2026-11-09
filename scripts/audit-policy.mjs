import { readFile } from 'node:fs/promises';
import process from 'node:process';

const migration = await readFile('supabase/migrations/20261109000100_initial_schema.sql', 'utf8');
const hook = await readFile('src/hooks.server.ts', 'utf8');
const config = await readFile('src/lib/server/config.ts', 'utf8');
const mediaUpload = await readFile('src/routes/api/media/upload/+server.ts', 'utf8');
const mediaDownload = await readFile('src/routes/api/media/[assetId]/+server.ts', 'utf8');
const exportRoute = await readFile('src/routes/api/export/[episodeId]/+server.ts', 'utf8');
const provider = await readFile('src/lib/providers/text-provider.ts', 'utf8');

const tables = [...migration.matchAll(/^create table public\.(\w+)\s*\(/gm)].map(
	(match) => match[1],
);
const checks = [
	['14 owner-scoped public tables', tables.length === 14],
	[
		'every table has forced RLS',
		migration.includes('enable row level security') &&
			migration.includes('force row level security') &&
			migration.includes('owner_id = (select auth.uid())'),
	],
	[
		'append-only history revokes update/delete',
		/grant select, insert on table public\.%I to authenticated/.test(migration) &&
			migration.includes("array['episode_revisions', 'poll_results', 'canonical_decisions']"),
	],
	[
		'revision, result, and canon records reject mutation',
		['reject_revision_mutation', 'reject_poll_result_mutation', 'reject_decision_mutation'].every(
			(name) => migration.includes(name),
		),
	],
	[
		'owner is checked using the verified server UID',
		hook.includes('supabase.auth.getUser()') &&
			hook.includes('data.user.id === config.ownerUserId') &&
			config.includes('SUPABASE_OWNER_USER_ID'),
	],
	[
		'all mutations verify same-origin requests',
		hook.includes('MUTATING_METHODS') && hook.includes('requestOrigin !== trustedOrigin'),
	],
	[
		'uploads require authenticated delivery and content decoding',
		mediaUpload.includes("type: 'authenticated'") &&
			mediaUpload.includes('detectedImageFormat') &&
			mediaUpload.includes('sharp(bytes'),
	],
	[
		'media is owner-bound and delivered privately',
		mediaDownload.includes("eq('owner_id', owner.id)") &&
			mediaDownload.includes('private_download_url') &&
			mediaDownload.includes('expires_at'),
	],
	[
		'exports are owner-bound and expire signed media URLs',
		exportRoute.includes("eq('owner_id', owner.id)") &&
			exportRoute.includes('private_download_url') &&
			exportRoute.includes('missing_frames.json'),
	],
	[
		'manual fallback never claims a live text provider',
		provider.includes("return 'NOT_CONFIGURED'") &&
			provider.includes('Continue in the manual editor'),
	],
];

let failed = false;
for (const [name, pass] of checks) {
	process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name}\n`);
	if (!pass) failed = true;
}
process.stdout.write(
	`Checked ${checks.length} policy invariants across ${tables.length} tables.\n`,
);
if (failed) process.exitCode = 1;
