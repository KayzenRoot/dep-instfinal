import { createHash, randomUUID } from 'node:crypto';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function detectedImageFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(SIGNATURE)) return 'png';
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return 'jpeg';
	if (
		bytes.length >= 12 &&
		bytes.toString('ascii', 0, 4) === 'RIFF' &&
		bytes.toString('ascii', 8, 12) === 'WEBP'
	)
		return 'webp';
	return null;
}

function uploadAuthenticated(bytes: Buffer, publicId: string) {
	return new Promise<
		Awaited<ReturnType<typeof cloudinary.uploader.upload_stream>> extends never
			? never
			: Record<string, unknown>
	>((resolve, reject) => {
		const upload = cloudinary.uploader.upload_stream(
			{
				resource_type: 'image',
				type: 'authenticated',
				public_id: publicId,
				overwrite: false,
				unique_filename: false,
				use_filename: false,
				invalidate: false,
			},
			(uploadError, result) => {
				if (uploadError || !result)
					reject(uploadError ?? new Error('Upload did not return an asset.'));
				else resolve(result as unknown as Record<string, unknown>);
			},
		);
		upload.end(bytes);
	});
}

export const POST: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	if (
		!config.cloudinaryConfigured ||
		!config.cloudinaryCloudName ||
		!config.cloudinaryApiKey ||
		!config.cloudinaryApiSecret
	)
		redirect(303, '/app/library?upload=unavailable');
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		error(400, 'Formulário inválido.');
	}
	const file = form.get('file');
	const assetKind = form.get('assetKind');
	if (form.get('rightsConfirmed') !== 'on')
		error(400, 'A confirmação de direitos autorais é necessária.');
	if (!(file instanceof File) || file.size < 1 || file.size > config.maxUploadBytes)
		error(413, 'Arquivo ausente ou acima do limite de tamanho.');
	if (!['FRAME', 'COVER', 'REFERENCE'].includes(String(assetKind)))
		error(400, 'Tipo de imagem inválido.');
	const bytes = Buffer.from(await file.arrayBuffer());
	const signatureFormat = detectedImageFormat(bytes);
	if (!signatureFormat) error(415, 'Somente PNG, JPEG e WebP são aceitos.');
	let metadata: Pick<
		Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>,
		'format' | 'width' | 'height'
	>;
	try {
		const image = sharp(bytes, { failOn: 'error', limitInputPixels: 16_777_216, animated: false });
		metadata = await image.metadata();
		await image.stats();
	} catch {
		error(415, 'A imagem está corrompida ou não pôde ser decodificada.');
	}
	if (
		metadata.format !== signatureFormat ||
		!metadata.width ||
		!metadata.height ||
		metadata.width > 4096 ||
		metadata.height > 4096
	)
		error(415, 'Dimensões ou formato real da imagem inválidos.');

	const publicId = `dif-studio/${randomUUID()}`;
	const { data: placeholder, error: metadataError } = await db
		.from('media_assets')
		.insert({
			owner_id: owner.id,
			public_id: publicId,
			resource_type: 'image',
			delivery_type: 'authenticated',
			asset_kind: assetKind,
			upload_status: 'UPLOADING',
		})
		.select('id')
		.single();
	if (metadataError || !placeholder) error(500, 'Não foi possível iniciar o registro da imagem.');

	cloudinary.config({
		cloud_name: config.cloudinaryCloudName,
		api_key: config.cloudinaryApiKey,
		api_secret: config.cloudinaryApiSecret,
		secure: true,
	});
	let uploadResult: Record<string, unknown>;
	try {
		uploadResult = await uploadAuthenticated(bytes, publicId);
	} catch {
		await db
			.from('media_assets')
			.update({ upload_status: 'FAILED', safe_error_code: 'CLOUDINARY_UPLOAD_FAILED' })
			.eq('id', placeholder.id)
			.eq('owner_id', owner.id);
		redirect(303, '/app/library?upload=failed');
	}
	const { error: finalizeError } = await db
		.from('media_assets')
		.update({
			cloudinary_asset_id: uploadResult.asset_id,
			format: uploadResult.format,
			byte_size: uploadResult.bytes,
			width: uploadResult.width,
			height: uploadResult.height,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			asset_version: uploadResult.version,
			upload_status: 'READY',
			safe_error_code: null,
			uploaded_at: new Date().toISOString(),
		})
		.eq('id', placeholder.id)
		.eq('owner_id', owner.id);
	if (finalizeError) {
		try {
			await cloudinary.uploader.destroy(publicId, {
				resource_type: 'image',
				type: 'authenticated',
				invalidate: true,
			});
			await db
				.from('media_assets')
				.update({ upload_status: 'FAILED', safe_error_code: 'METADATA_FINALIZATION_FAILED' })
				.eq('id', placeholder.id)
				.eq('owner_id', owner.id);
		} catch {
			await db
				.from('media_assets')
				.update({ upload_status: 'ORPHANED', safe_error_code: 'METADATA_FINALIZATION_FAILED' })
				.eq('id', placeholder.id)
				.eq('owner_id', owner.id);
		}
		redirect(303, '/app/library?upload=failed');
	}
	redirect(303, '/app/library?upload=success');
};
