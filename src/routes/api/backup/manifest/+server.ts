import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';

const TABLES = [
	'series',
	'seasons',
	'characters',
	'lore_facts',
	'episodes',
	'episode_revisions',
	'media_assets',
	'scenes',
	'choices',
	'polls',
	'poll_results',
	'canonical_decisions',
	'image_references',
	'generation_jobs',
	'video_upload_sessions',
	'video_assets',
	'video_edit_plans',
	'video_edit_plan_versions',
] as const;

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const [assetsResult, ...counts] = await Promise.all([
		db
			.from('media_assets')
			.select(
				'id,cloudinary_asset_id,public_id,resource_type,delivery_type,asset_kind,format,byte_size,width,height,sha256,asset_version,upload_status,uploaded_at',
			)
			.eq('owner_id', owner.id)
			.order('created_at'),
		...TABLES.map((table) =>
			db.from(table).select('id', { count: 'exact', head: true }).eq('owner_id', owner.id),
		),
	]);
	if (assetsResult.error || counts.some((result) => result.error))
		error(503, 'Não foi possível criar o manifesto privado.');
	const generatedAt = new Date().toISOString();
	const manifest = {
		format: 'dif-studio-owner-backup-manifest/v1',
		generatedAt,
		ownerId: owner.id,
		database: {
			sourceOfTruth: 'Supabase PostgreSQL',
			tables: Object.fromEntries(TABLES.map((table, index) => [table, counts[index]?.count ?? 0])),
		},
		media: { binaryStore: 'Cloudinary authenticated delivery', assets: assetsResult.data ?? [] },
		restoreNotes: [
			'Restore PostgreSQL into a dedicated selected project, preserving owner UID mappings.',
			'Reconcile each media asset by cloudinary_asset_id, public_id, version, SHA-256 and associations.',
			'Image bytes are not part of this manifest; retrieve them only through authorized Cloudinary delivery.',
		],
	};
	return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': 'attachment; filename="dif-studio-backup-manifest.json"',
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff',
		},
	});
};
