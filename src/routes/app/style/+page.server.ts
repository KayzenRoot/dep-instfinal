import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import {
	clearEpisodeStyleOverride,
	clearSceneStyleOverride,
	exportStylePreset,
	importStylePreset,
	loadStylePageContext,
	resolveEpisodeStyleSnapshot,
	saveEpisodeStyleOverride,
	saveSceneStyleOverride,
	saveStylePreset,
	StyleServiceError,
	type StylePreset,
} from '#lib/server/style-bible.js';
import {
	styleConfigSchema,
	styleOverrideSchema,
	type StyleConfig,
	type StyleOverride,
	type StyleScopeType,
} from '#lib/schemas/style-bible.js';

function messageFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof StyleServiceError) return { status: cause.status, message: cause.message };
	if (cause instanceof Error && cause.name === 'ZodError')
		return { status: 400, message: 'Configuração de estilo inválida.' };
	return { status: 503, message: 'Não foi possível processar a bíblia audiovisual.' };
}

function rethrowRedirect(cause: unknown): void {
	if (cause && typeof cause === 'object' && 'location' in cause) throw cause;
}

function readNumber(form: FormData, key: string): number {
	const value = Number(readFormText(form, key));
	return Number.isFinite(value) ? value : 0;
}

function configFromForm(form: FormData): StyleConfig {
	return styleConfigSchema.parse({
		schemaVersion: 1,
		paletteBackground: readFormText(form, 'paletteBackground'),
		paletteForeground: readFormText(form, 'paletteForeground'),
		paletteAccent: readFormText(form, 'paletteAccent'),
		paletteMuted: readFormText(form, 'paletteMuted'),
		colorPresetId: readFormText(form, 'colorPresetId'),
		colorStrength: readNumber(form, 'colorStrength') / 100,
		fontFamily: readFormText(form, 'fontFamily'),
		captionTemplate: readFormText(form, 'captionTemplate'),
		captionSafeZone: readFormText(form, 'captionSafeZone'),
		motion: readFormText(form, 'motion'),
		reducedMotion: readFormText(form, 'reducedMotion') === 'on',
		vhsIntensity: readNumber(form, 'vhsIntensity'),
		sfxCategory: readFormText(form, 'sfxCategory'),
		sfxAssetIds: readFormText(form, 'sfxAssetIds')
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean),
		voiceStyle: readFormText(form, 'voiceStyle'),
		openingHookKind: readFormText(form, 'openingHookKind'),
		coverTemplateId: readFormText(form, 'coverTemplateId'),
		endCardTemplateId: readFormText(form, 'endCardTemplateId'),
		ctaPrompt: readFormText(form, 'ctaPrompt'),
	});
}

function overrideFromForm(form: FormData): StyleOverride {
	const raw: Record<string, unknown> = {};
	const stringFields = [
		'paletteBackground',
		'paletteForeground',
		'paletteAccent',
		'paletteMuted',
		'colorPresetId',
		'fontFamily',
		'captionTemplate',
		'captionSafeZone',
		'motion',
		'sfxCategory',
		'voiceStyle',
		'openingHookKind',
		'coverTemplateId',
		'endCardTemplateId',
		'ctaPrompt',
	];
	for (const field of stringFields) {
		const value = readFormText(form, field);
		if (value) raw[field] = value;
	}
	const strength = readFormText(form, 'colorStrength');
	if (strength) raw.colorStrength = Number(strength) / 100;
	const vhs = readFormText(form, 'vhsIntensity');
	if (vhs) raw.vhsIntensity = Number(vhs);
	if (readFormText(form, 'sfxOverride') === 'on') {
		raw.sfxAssetIds = readFormText(form, 'sfxAssetIds')
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
	}
	const reducedMotion = readFormText(form, 'reducedMotion');
	if (reducedMotion === 'true') raw.reducedMotion = true;
	else if (reducedMotion === 'false') raw.reducedMotion = false;
	return styleOverrideSchema.parse(raw);
}

function presetFor(presets: StylePreset[], id: string | null): StylePreset | null {
	return id ? (presets.find((preset) => preset.id === id) ?? null) : null;
}

function redirectFor(form: FormData, suffix: string): never {
	const scopeType = readFormText(form, 'scopeType') || 'SERIES';
	const scopeId = readFormText(form, 'scopeId');
	const episodeId = readFormText(form, 'episodeId');
	const sceneId = readFormText(form, 'sceneId');
	redirect(
		303,
		`/app/style?scopeType=${scopeType}&scopeId=${scopeId}${episodeId ? `&episodeId=${episodeId}` : ''}${sceneId ? `&sceneId=${sceneId}` : ''}&${suffix}`,
	);
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const context = await loadStylePageContext(db, owner);
	const scopeType = (
		event.url.searchParams.get('scopeType') === 'SEASON' ? 'SEASON' : 'SERIES'
	) as StyleScopeType;
	const requestedScopeId = event.url.searchParams.get('scopeId');
	const scopeOptions = scopeType === 'SERIES' ? context.series : context.seasons;
	const fallbackScopeId = scopeOptions[0]?.id ?? '';
	const scopeId = scopeOptions.some((option) => option.id === requestedScopeId)
		? requestedScopeId!
		: fallbackScopeId;
	const selectedPreset =
		context.presets.find(
			(preset) => preset.scopeType === scopeType && preset.scopeId === scopeId,
		) ?? null;
	const scopeEpisodes = context.episodes.filter((episode) =>
		scopeType === 'SERIES' ? episode.seriesId === scopeId : episode.seasonId === scopeId,
	);
	const requestedEpisodeId = event.url.searchParams.get('episodeId');
	const episodeId =
		scopeEpisodes.find((episode) => episode.id === requestedEpisodeId)?.id ??
		scopeEpisodes[0]?.id ??
		context.episodes[0]?.id ??
		'';
	let preview = null;
	let previewError: string | null = null;
	let scenes: Array<{ id: string; index: number }> = [];
	if (episodeId) {
		try {
			preview = await resolveEpisodeStyleSnapshot(db, owner, episodeId);
			const { data, error: scenesError } = await db
				.from('scenes')
				.select('id,scene_index')
				.eq('owner_id', owner.id)
				.eq('episode_id', episodeId)
				.order('scene_index')
				.limit(60);
			if (scenesError) throw scenesError;
			scenes = (data ?? []).map((row) => ({
				id: row.id as string,
				index: Number(row.scene_index),
			}));
		} catch (cause) {
			preview = null;
			previewError =
				cause instanceof StyleServiceError
					? cause.message
					: 'Não foi possível resolver a herança de estilo deste episódio.';
		}
	}
	const notice = event.url.searchParams.get('saved') ? event.url.searchParams.get('saved') : null;
	const requestedSceneId = event.url.searchParams.get('sceneId');
	const selectedSceneId =
		scenes.find((scene) => scene.id === requestedSceneId)?.id ?? scenes[0]?.id ?? '';
	return {
		context,
		scopeType,
		scopeId,
		selectedPreset,
		episodeId,
		selectedSceneId,
		preview,
		previewError,
		scenes,
		notice,
		error: null,
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		try {
			await saveStylePreset({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				values: {
					scopeType: readFormText(form, 'scopeType'),
					scopeId: readFormText(form, 'scopeId'),
					name: readFormText(form, 'name'),
					expectedRevision: Number(readFormText(form, 'expectedRevision')),
					config: configFromForm(form),
					status: 'DRAFT',
				},
			});
			redirectFor(form, 'saved=preset');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	approve: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		try {
			const context = await loadStylePageContext(db, owner);
			const preset = presetFor(context.presets, readFormText(form, 'presetId'));
			if (!preset) throw new StyleServiceError(404, 'STYLE_NOT_FOUND', 'Preset não encontrado.');
			const requestedRevision = Number(readFormText(form, 'revision'));
			const source =
				preset.revisions.find((revision) => revision.revision === requestedRevision) ??
				preset.revisions[0];
			if (!source) throw new StyleServiceError(404, 'STYLE_NOT_FOUND', 'Preset sem revisão.');
			await saveStylePreset({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				values: {
					scopeType: preset.scopeType,
					scopeId: preset.scopeId,
					name: preset.name,
					expectedRevision: preset.latestRevision,
					config: source.config,
					status: 'APPROVED',
				},
			});
			redirectFor(form, 'saved=approved');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		try {
			const context = await loadStylePageContext(db, owner);
			const preset = presetFor(context.presets, readFormText(form, 'presetId'));
			const revisionNumber = Number(readFormText(form, 'revision'));
			const revision = preset?.revisions.find((entry) => entry.revision === revisionNumber);
			if (!preset || !revision)
				throw new StyleServiceError(404, 'STYLE_NOT_FOUND', 'Revisão não encontrada.');
			await saveStylePreset({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				values: {
					scopeType: preset.scopeType,
					scopeId: preset.scopeId,
					name: preset.name,
					expectedRevision: preset.latestRevision,
					config: revision.config,
					status: 'DRAFT',
				},
			});
			redirectFor(form, 'saved=restored');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	duplicate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		try {
			const source = await exportStylePreset(db, owner, readFormText(form, 'presetId'));
			await importStylePreset({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				payload: {
					...source,
					name: (readFormText(form, 'targetName') || `${source.name} (cópia)`).slice(0, 80),
					scopeType: readFormText(form, 'targetScopeType'),
					scopeId: readFormText(form, 'targetScopeId'),
				},
			});
			redirectFor(form, 'saved=duplicated');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	import: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(readFormText(form, 'json')) as Record<string, unknown>;
		} catch {
			return fail(400, { message: 'JSON de estilo inválido.' });
		}
		try {
			await importStylePreset({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				payload: {
					...payload,
					name: readFormText(form, 'name') || payload.name,
					scopeType: readFormText(form, 'scopeType'),
					scopeId: readFormText(form, 'scopeId'),
				},
			});
			redirectFor(form, 'saved=imported');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	override: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		if (!episodeId) return fail(400, { message: 'Episódio inválido.' });
		try {
			const config = overrideFromForm(form);
			if (Object.keys(config).length === 0) {
				await clearEpisodeStyleOverride({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					episodeId,
				});
			} else {
				await saveEpisodeStyleOverride({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					episodeId,
					config,
				});
			}
			redirectFor(form, 'saved=override');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	sceneOverride: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const sceneId = readFormText(form, 'sceneId');
		if (!sceneId) return fail(400, { message: 'Cena inválida.' });
		try {
			const config = overrideFromForm(form);
			if (Object.keys(config).length === 0) {
				await clearSceneStyleOverride({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					sceneId,
				});
			} else {
				await saveSceneStyleOverride({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					sceneId,
					config,
				});
			}
			redirectFor(form, 'saved=scene-override');
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
};
