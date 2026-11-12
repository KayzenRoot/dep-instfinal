import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';

const variants = {
	thumb: [{ width: 320, height: 180, crop: 'fill' }],
	'4x5': [{ width: 432, height: 540, crop: 'fill' }],
	'3x4': [{ width: 432, height: 576, crop: 'fill' }],
} as const;

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const variant = event.url.searchParams.get('variant');
	const download = event.url.searchParams.get('download');
	if (download !== null && download !== '1') error(400, 'Modo de download inválido.');
	if (download && variant) error(400, 'Download original não aceita transformação.');
	if (variant && !Object.hasOwn(variants, variant)) error(400, 'Variante de imagem inválida.');
	if (
		!config.cloudinaryConfigured ||
		!config.cloudinaryCloudName ||
		!config.cloudinaryApiKey ||
		!config.cloudinaryApiSecret
	)
		error(503, 'Private image delivery is not configured.');
	const { data: asset, error: queryError } = await db
		.from('media_assets')
		.select('id,public_id,resource_type,delivery_type,format,upload_status')
		.eq('id', event.params.assetId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (
		queryError ||
		!asset ||
		asset.upload_status !== 'READY' ||
		asset.resource_type !== 'image' ||
		!['authenticated', 'private'].includes(asset.delivery_type)
	)
		error(404, 'Imagem não encontrada.');
	cloudinary.config({
		cloud_name: config.cloudinaryCloudName,
		api_key: config.cloudinaryApiKey,
		api_secret: config.cloudinaryApiSecret,
		secure: true,
	});
	const expiresAt = Math.floor(Date.now() / 1000) + 300;
	if (download === '1') {
		// Only an authenticated owner can request this redirect. A short-lived
		// signed URL lets large originals download directly from Cloudinary,
		// bypassing Vercel's 4.5 MB Function response payload cap.
		const signedUrl = cloudinary.utils.private_download_url(asset.public_id, asset.format, {
			resource_type: 'image',
			type: asset.delivery_type,
			attachment: true,
			expires_at: Math.floor(Date.now() / 1000) + 180,
		});
		return new Response(null, {
			status: 302,
			headers: {
				location: signedUrl,
				'cache-control': 'private, no-store',
				'referrer-policy': 'no-referrer',
				'x-content-type-options': 'nosniff',
			},
		});
	}
	// Derived images use a signed authenticated delivery URL generated on the
	// server only. The URL is fetched here and never returned to the browser.
	const url = variant
		? cloudinary.url(asset.public_id, {
				resource_type: 'image',
				type: asset.delivery_type,
				sign_url: true,
				secure: true,
				transformation: variants[variant as keyof typeof variants],
			})
		: cloudinary.utils.private_download_url(asset.public_id, asset.format, {
				resource_type: 'image',
				type: asset.delivery_type,
				attachment: false,
				expires_at: expiresAt,
			});
	let upstream: Response;
	try {
		upstream = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
	} catch {
		error(502, 'A imagem privada está temporariamente indisponível.');
	}
	if (!upstream.ok || !upstream.body)
		error(502, 'A imagem privada está temporariamente indisponível.');
	const contentType =
		asset.format === 'jpg'
			? 'image/jpeg'
			: asset.format === 'jpeg'
				? 'image/jpeg'
				: `image/${asset.format}`;
	return new Response(upstream.body, {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
			'content-disposition': 'inline',
		},
	});
};
