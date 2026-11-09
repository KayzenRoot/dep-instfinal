import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
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
	default: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const assetId = form.get('assetId');
		const errorCode = form.get('errorCode');
		if (
			typeof assetId !== 'string' ||
			!/^[0-9a-f-]{36}$/i.test(assetId) ||
			typeof errorCode !== 'string' ||
			errorCode.length > 80
		)
			return fail(400, { message: 'Registro de mídia inválido.' });
		const { error: updateError } = await db
			.from('media_assets')
			.update({ safe_error_code: errorCode })
			.eq('id', assetId)
			.eq('owner_id', owner.id)
			.in('upload_status', ['FAILED', 'ORPHANED']);
		if (updateError) return fail(500, { message: 'Não foi possível atualizar o registro.' });
		return { assetUpdated: true };
	},
};
