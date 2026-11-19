import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { summarizeRgbFrames, type ColorStats } from '#lib/domain/color-quality.js';
import { getAppConfig } from './config.js';

export interface PrivateImageAsset {
	id: string;
	public_id: string;
	format: string;
	delivery_type: string;
}

const WIDTH = 64;
const HEIGHT = 114;

/**
 * Downloads an owner-validated private image on the server and reduces it to
 * RGB statistics. Signed URLs never leave this function.
 */
export async function measurePrivateImageAsset(
	asset: PrivateImageAsset,
): Promise<ColorStats | null> {
	const config = getAppConfig();
	if (
		!config.cloudinaryConfigured ||
		!config.cloudinaryCloudName ||
		!config.cloudinaryApiKey ||
		!config.cloudinaryApiSecret
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
		if (!bytes.length || bytes.length > config.maxUploadBytes) return null;
		const { data, info } = await sharp(bytes, {
			failOn: 'error',
			limitInputPixels: 16_777_216,
			animated: false,
		})
			.resize(WIDTH, HEIGHT, { fit: 'fill' })
			.removeAlpha()
			.toColourspace('srgb')
			.raw()
			.toBuffer({ resolveWithObject: true });
		return summarizeRgbFrames(Buffer.from(data), info.width, info.height);
	} catch {
		return null;
	}
}

export async function measurePrivateImageAssets(
	assets: PrivateImageAsset[],
	concurrency = 4,
): Promise<Map<string, ColorStats | null>> {
	const results = new Map<string, ColorStats | null>();
	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < assets.length) {
			const asset = assets[cursor];
			cursor += 1;
			if (!asset) return;
			results.set(asset.id, await measurePrivateImageAsset(asset));
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, () => worker()));
	return results;
}
