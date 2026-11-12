import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('media_assets')
		.select('id,asset_kind,format,byte_size,width,height,upload_status,created_at,safe_error_code')
		.eq('owner_id', owner.id)
		.order('created_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar a biblioteca visual.');
	return {
		assets: data ?? [],
		cloudinaryConfigured: getAppConfig().cloudinaryConfigured,
		uploadState: event.url.searchParams.get('upload'),
	};
};

export const actions: Actions = {
	reconcileAsset: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const assetId = form.get('assetId');
		if (typeof assetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(assetId))
			return fail(400, { message: 'Registro de mídia inválido.' });
		const config = getAppConfig();
		if (
			!config.cloudinaryConfigured ||
			!config.cloudinaryCloudName ||
			!config.cloudinaryApiKey ||
			!config.cloudinaryApiSecret
		)
			return fail(503, { message: 'Cloudinary não está configurado para reconciliação.' });
		const { data: asset, error: queryError } = await db
			.from('media_assets')
			.select('id,public_id,delivery_type,upload_status')
			.eq('id', assetId)
			.eq('owner_id', owner.id)
			.in('upload_status', ['UPLOADING', 'FAILED', 'ORPHANED'])
			.maybeSingle();
		if (queryError || !asset)
			return fail(404, { message: 'Registro não encontrado para reconciliação.' });
		cloudinary.config({
			cloud_name: config.cloudinaryCloudName,
			api_key: config.cloudinaryApiKey,
			api_secret: config.cloudinaryApiSecret,
			secure: true,
		});
		let resource: Record<string, unknown>;
		try {
			resource = (await cloudinary.api.resource(asset.public_id, {
				resource_type: 'image',
				type: asset.delivery_type,
			})) as Record<string, unknown>;
		} catch (cause) {
			const failure =
				typeof cause === 'object' && cause !== null
					? (cause as { http_code?: unknown; error?: { http_code?: unknown } })
					: null;
			const httpCode = failure?.http_code ?? failure?.error?.http_code;
			const notFound = httpCode === 404;
			const { error: markError } = await db
				.from('media_assets')
				.update({
					upload_status: notFound ? 'FAILED' : 'ORPHANED',
					safe_error_code: notFound
						? 'CLOUDINARY_ASSET_NOT_FOUND'
						: 'CLOUDINARY_RECONCILIATION_FAILED',
				})
				.eq('id', asset.id)
				.eq('owner_id', owner.id);
			if (markError)
				return fail(503, { message: 'Não foi possível salvar o estado reconciliado.' });
			return { reconciled: false };
		}
		if (
			typeof resource.asset_id !== 'string' ||
			typeof resource.version !== 'number' ||
			typeof resource.format !== 'string'
		)
			return fail(502, { message: 'Cloudinary retornou metadados incompletos.' });
		const downloadFormat = resource.format;
		const url = cloudinary.utils.private_download_url(asset.public_id, downloadFormat, {
			resource_type: 'image',
			type: asset.delivery_type,
			attachment: false,
			expires_at: Math.floor(Date.now() / 1000) + 300,
		});
		let bytes: Buffer;
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
			if (!response.ok) return fail(502, { message: 'O arquivo privado não pôde ser baixado.' });
			bytes = Buffer.from(await response.arrayBuffer());
			if (!bytes.length || bytes.length > config.maxUploadBytes)
				return fail(413, { message: 'O arquivo reconciliado excede o limite permitido.' });
		} catch {
			return fail(502, { message: 'O arquivo privado não pôde ser validado.' });
		}
		let metadata: Metadata;
		try {
			const image = sharp(bytes, {
				failOn: 'error',
				limitInputPixels: 16_777_216,
				animated: false,
			});
			metadata = await image.metadata();
			await image.stats();
		} catch {
			return fail(415, { message: 'O arquivo reconciliado não é uma imagem íntegra.' });
		}
		if (
			!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
			!metadata.width ||
			!metadata.height ||
			metadata.width > 4096 ||
			metadata.height > 4096
		)
			return fail(415, { message: 'Formato ou dimensões da imagem reconciliada são inválidos.' });
		const format = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
		const { error: updateError } = await db
			.from('media_assets')
			.update({
				cloudinary_asset_id: resource.asset_id,
				format,
				byte_size: bytes.length,
				width: metadata.width,
				height: metadata.height,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				asset_version: resource.version,
				upload_status: 'READY',
				safe_error_code: null,
				uploaded_at: new Date().toISOString(),
			})
			.eq('id', asset.id)
			.eq('owner_id', owner.id);
		if (updateError)
			return fail(503, { message: 'Não foi possível salvar os metadados reconciliados.' });
		return { reconciled: true };
	},
};
