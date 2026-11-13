import { readFile } from 'node:fs/promises';
import process from 'node:process';

const migration = await readFile('supabase/migrations/20261109000100_initial_schema.sql', 'utf8');
const narrativeMigration = await readFile(
	'supabase/migrations/20261110135310_narrative_manual_import.sql',
	'utf8',
);
const videoMigration = await readFile(
	'supabase/migrations/20261112170000_v2_wo003_video_storage.sql',
	'utf8',
);
const videoBoundaryMigration = await readFile(
	'supabase/migrations/20261112200000_v2_wo003_asset_boundary.sql',
	'utf8',
);
const videoSessionBoundaryMigration = await readFile(
	'supabase/migrations/20261112210000_v2_wo003_session_boundary.sql',
	'utf8',
);
const editPlanMigration = await readFile(
	'supabase/migrations/20261113090000_v2_wo004_edit_plans.sql',
	'utf8',
);
const editPlanServerMigration = await readFile(
	'supabase/migrations/20261113091000_v2_wo004_edit_plan_server_rpc.sql',
	'utf8',
);
const editPlanConflictMigration = await readFile(
	'supabase/migrations/20261113093000_v2_wo004_conflict_semantics.sql',
	'utf8',
);
const renderJobMigration = await readFile(
	'supabase/migrations/20261113100000_v2_wo005_render_jobs.sql',
	'utf8',
);
const renderWorkerGrantsMigration = await readFile(
	'supabase/migrations/20261113101000_v2_wo006_worker_grants.sql',
	'utf8',
);
const hook = await readFile('src/hooks.server.ts', 'utf8');
const config = await readFile('src/lib/server/config.ts', 'utf8');
const mediaUpload = await readFile('src/routes/api/media/upload/+server.ts', 'utf8');
const mediaDownload = await readFile('src/routes/api/media/[assetId]/+server.ts', 'utf8');
const mediaLibrary = await readFile('src/routes/app/library/+page.server.ts', 'utf8');
const exportRoute = await readFile('src/routes/api/export/[episodeId]/+server.ts', 'utf8');
const provider = await readFile('src/lib/providers/text-provider.ts', 'utf8');
const narrativeContext = await readFile('src/lib/server/narrative-context.ts', 'utf8');
const promptRoute = await readFile(
	'src/routes/api/narrative-prompt/[episodeId]/+server.ts',
	'utf8',
);
const narrativeExport = await readFile('src/routes/api/export/[episodeId]/+server.ts', 'utf8');
const videoUpload = await readFile('src/routes/api/video/uploads/+server.ts', 'utf8');
const videoComplete = await readFile(
	'src/routes/api/video/uploads/[sessionId]/complete/+server.ts',
	'utf8',
);
const videoAssets = await readFile('src/lib/server/video-assets.ts', 'utf8');
const videoStorage = await readFile('src/lib/server/video-storage.ts', 'utf8');
const videoDownload = await readFile('src/routes/api/video/[assetId]/+server.ts', 'utf8');
const timelineRoute = await readFile('src/routes/app/timeline/+page.server.ts', 'utf8');
const editPlans = await readFile('src/lib/server/video-edit-plans.ts', 'utf8');

const tables = [
	...migration.matchAll(/^create table public\.(\w+)\s*\(/gm),
	...videoMigration.matchAll(/^create table public\.(\w+)\s*\(/gm),
	...editPlanMigration.matchAll(/^create table public\.(\w+)\s*\(/gm),
	...renderJobMigration.matchAll(/^create table public\.(\w+)\s*\(/gm),
].map((match) => match[1]);
const checks = [
	['20 owner-scoped public tables', tables.length === 20],
	[
		'every table has forced RLS',
		migration.includes('enable row level security') &&
			migration.includes('force row level security') &&
			migration.includes('owner_id = (select auth.uid())') &&
			migration.includes("auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner''"),
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
		'ambiguous upload failures remain reconcilable and private records are owner-scoped',
		mediaUpload.includes("upload_status: 'ORPHANED'") &&
			mediaUpload.includes('CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN') &&
			mediaLibrary.includes("eq('owner_id', owner.id)") &&
			mediaLibrary.includes('private_download_url') &&
			mediaLibrary.includes("upload_status: 'READY'"),
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
	[
		'manual response import is owner-checked, atomic and unavailable to anonymous roles',
		narrativeMigration.includes('auth.uid()') &&
			narrativeMigration.includes("auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner'") &&
			narrativeMigration.includes('public.append_episode_revision') &&
			narrativeMigration.includes('revoke all on function public.import_narrative_response') &&
			narrativeMigration.includes('grant execute on function public.import_narrative_response'),
	],
	[
		'narrative context reads only owner-scoped story, vote, and canon records',
		(narrativeContext.match(/\.eq\('owner_id', ownerId\)/g) ?? []).length >= 7 &&
			narrativeContext.includes(".from('canonical_decisions')") &&
			narrativeContext.includes(".from('poll_results')"),
	],
	[
		'narrative prompt export is authenticated, private, and cache-disabled',
		promptRoute.includes('ownerDatabase(event)') &&
			promptRoute.includes("'cache-control': 'private, no-store'") &&
			promptRoute.includes('renderNarrativePrompt'),
	],
	[
		'Flow export carries the canonical narrative context',
		narrativeExport.includes("name: 'narrative/context.json'") &&
			narrativeExport.includes("name: 'narrative/continuation-prompt.md'") &&
			narrativeExport.includes('loadNarrativeContext'),
	],
	[
		'video metadata tables force owner-only RLS',
		videoMigration.includes('enable row level security') &&
			videoMigration.includes('force row level security') &&
			videoMigration.includes('owner_id = (select auth.uid())') &&
			videoMigration.includes('dif_studio_owner') &&
			videoMigration.includes('video_upload_sessions') &&
			videoMigration.includes('video_assets'),
	],
	[
		'video upload is owner-scoped, idempotent, bounded and quarantined',
		videoUpload.includes('ownerDatabase(event)') &&
			videoUpload.includes('videoUploadInitSchema') &&
			videoComplete.includes('getVideoProbe') &&
			videoComplete.includes('completeUploadSession') &&
			videoAssets.includes('idempotency_key') &&
			videoAssets.includes("status: ready ? 'READY' : 'QUARANTINED'") &&
			videoAssets.includes('hasMp4Magic') &&
			videoAssets.includes('validateProbe'),
	],
	[
		'video session keys and lifecycle writes are server-owned',
		videoSessionBoundaryMigration.includes(
			'revoke insert, update, delete on table public.video_upload_sessions',
		) &&
			videoSessionBoundaryMigration.includes('video_upload_sessions_server_key_check') &&
			videoSessionBoundaryMigration.includes('guard_video_upload_session_update') &&
			videoUpload.includes('createSupabaseAdminClient') &&
			videoAssets.includes('requireSessionWriter') &&
			videoAssets.includes('quarantineObjectKey(ownerId, session.id)'),
	],
	[
		'video READY and tombstone writes are server-mediated',
		videoBoundaryMigration.includes('revoke update, delete on table public.video_assets') &&
			videoBoundaryMigration.includes('guard_video_asset_insert') &&
			videoBoundaryMigration.includes("current_user = 'authenticated'") &&
			videoComplete.includes('createSupabaseAdminClient') &&
			videoAssets.includes('adminDb') &&
			videoAssets.includes('if (ready && !input.adminDb)') &&
			!videoUpload.includes('SUPABASE_SERVICE_ROLE_KEY'),
	],
	[
		'video edit plans are owner-only, versioned and append-only',
		editPlanMigration.includes('video_edit_plans') &&
			editPlanMigration.includes('video_edit_plan_versions') &&
			editPlanMigration.includes('security definer') &&
			editPlanMigration.includes('edit_plan_version_conflict') &&
			editPlanMigration.includes('video_edit_plan_versions_are_immutable') &&
			editPlanMigration.includes('revoke all on table public.video_edit_plan_versions') &&
			editPlanMigration.includes('grant select on table public.video_edit_plan_versions'),
	],
	[
		'video edit plan writes are server-only and hash-verified',
		editPlanServerMigration.includes('revoke all on function public.save_video_edit_plan') &&
			editPlanServerMigration.includes('to service_role') &&
			editPlanServerMigration.includes('p_expected_version is null') &&
			editPlans.includes('p_owner_id') &&
			editPlans.includes('EDIT_PLAN_HASH_MISMATCH') &&
			editPlanConflictMigration.includes("errcode = 'P0001'") &&
			!editPlanConflictMigration.includes("errcode = '40001'") &&
			timelineRoute.includes('createSupabaseAdminClient'),
	],
	[
		'render jobs use owner-read, server-write leases and recovery',
		renderJobMigration.includes('render_jobs') &&
			renderJobMigration.includes('render_job_events') &&
			renderJobMigration.includes('claim_render_job') &&
			renderJobMigration.includes('reconcile_render_jobs') &&
			renderJobMigration.includes('pg_advisory_xact_lock') &&
			renderJobMigration.includes('revoke all on table public.render_jobs') &&
			renderJobMigration.includes('to service_role') &&
			renderWorkerGrantsMigration.includes(
				'grant select on table public.episodes to service_role',
			) &&
			renderWorkerGrantsMigration.includes('grant select on table public.scenes to service_role') &&
			renderWorkerGrantsMigration.includes(
				'grant select on table public.video_assets to service_role',
			),
	],
	[
		'video storage is private, multipart and short-lived signed',
		videoStorage.includes('CreateMultipartUploadCommand') &&
			videoStorage.includes('signDownload') &&
			videoStorage.includes('expiresInSeconds') &&
			videoDownload.includes('getVideoAssetForDownload') &&
			videoDownload.includes("'cache-control': 'private, no-store'"),
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
