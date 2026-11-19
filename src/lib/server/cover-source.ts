import { v2 as cloudinary } from 'cloudinary';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAppConfig } from './config.js';

export async function loadCoverSource(
	db: SupabaseClient,
	ownerId: string,
	assetId: string | null,
): Promise<Buffer | null> {
	if (!assetId) return null;
	const config = getAppConfig();
	if (
		!config.cloudinaryConfigured ||
		!config.cloudinaryCloudName ||
		!config.cloudinaryApiKey ||
		!config.cloudinaryApiSecret
	)
		return null;
	const { data: asset, error } = await db
		.from('media_assets')
		.select('id,public_id,format,delivery_type,upload_status,resource_type')
		.eq('owner_id', ownerId)
		.eq('id', assetId)
		.maybeSingle();
	if (
		error ||
		!asset ||
		asset.upload_status !== 'READY' ||
		asset.resource_type !== 'image' ||
		!['authenticated', 'private'].includes(asset.delivery_type)
	)
		return null;
	cloudinary.config({
		cloud_name: config.cloudinaryCloudName,
		api_key: config.cloudinaryApiKey,
		api_secret: config.cloudinaryApiSecret,
		secure: true,
	});
	const url = cloudinary.utils.private_download_url(asset.public_id, asset.format, {
		resource_type: 'image',
		type: asset.delivery_type,
		attachment: false,
		expires_at: Math.floor(Date.now() / 1000) + 180,
	});
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
		if (!response.ok) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		return bytes.length && bytes.length <= config.maxUploadBytes ? bytes : null;
	} catch {
		return null;
	}
}
