import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { videoBackend } from '#lib/server/video-http.js';
import {
	AudioLibraryError,
	listAudioAssets,
	storeAudioAsset,
	updateAudioAssetLicense,
} from '#lib/server/audio-library.js';
import { audioKindSchema, type AudioKind } from '#lib/schemas/audio-library.js';

function parseMetadata(form: FormData) {
	return {
		kind: readFormText(form, 'kind'),
		title: readFormText(form, 'title'),
		author: readFormText(form, 'author'),
		source: readFormText(form, 'source'),
		licenseName: readFormText(form, 'licenseName'),
		licenseUrl: readFormText(form, 'licenseUrl') || null,
		attribution: readFormText(form, 'attribution'),
		commercialAllowed: form.get('commercialAllowed') === 'on',
		socialAllowed: form.get('socialAllowed') === 'on',
		licenseStatus: readFormText(form, 'licenseStatus') || 'UNKNOWN',
		tags: [
			...new Set(
				readFormText(form, 'tags')
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean),
			),
		],
		intensity: Number.parseInt(readFormText(form, 'intensity') || '3', 10),
	};
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const kindParam = audioKindSchema.safeParse(event.url.searchParams.get('kind'));
	const kind: AudioKind | null = kindParam.success ? kindParam.data : null;
	const tag = event.url.searchParams.get('tag')?.trim() || null;
	try {
		return {
			assets: await listAudioAssets(db, owner, { kind, tag }),
			filter: { kind, tag },
			loadError: null,
		};
	} catch (cause) {
		return {
			assets: [],
			filter: { kind, tag },
			loadError: cause instanceof Error ? cause.message : 'Não foi possível carregar a biblioteca.',
		};
	}
};

export const actions: Actions = {
	license: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const assetId = readFormText(form, 'assetId');
		try {
			await updateAudioAssetLicense({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				assetId,
				license: {
					licenseStatus: readFormText(form, 'licenseStatus'),
					commercialAllowed: form.get('commercialAllowed') === 'on',
					socialAllowed: form.get('socialAllowed') === 'on',
					attribution: readFormText(form, 'attribution'),
				},
			});
			return { success: true, licenseUpdated: true };
		} catch (cause) {
			if (cause instanceof AudioLibraryError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível atualizar a licença.' });
		}
	},
	upload: async (event) => {
		const { owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const file = form.get('file');
		if (!(file instanceof File)) return fail(400, { message: 'Selecione um arquivo de áudio.' });
		const backend = videoBackend(getAppConfig());
		if ('response' in backend)
			return fail(503, { message: 'O storage privado não está configurado.' });
		try {
			const asset = await storeAudioAsset({
				adminDb: createSupabaseAdminClient(),
				owner,
				storage: backend.storage,
				bytes: Buffer.from(await file.arrayBuffer()),
				fileName: file.name,
				metadata: parseMetadata(form),
			});
			return { success: true, assetId: asset.id, title: asset.title };
		} catch (cause) {
			if (cause instanceof AudioLibraryError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível importar o áudio.' });
		}
	},
};
