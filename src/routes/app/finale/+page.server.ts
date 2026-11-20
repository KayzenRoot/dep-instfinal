import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeSelection } from '#lib/server/episode-options.js';
import {
	ChoiceEndCardError,
	loadChoiceEndCard,
	loadChoiceEndCardContext,
	saveChoiceEndCard,
} from '#lib/server/choice-end-card.js';
import {
	defaultEditPlan,
	loadEditPlan,
	loadEditPlanContext,
	saveVideoEditPlan,
	VideoEditPlanError,
} from '#lib/server/video-edit-plans.js';
import { EditPlanError } from '#lib/domain/video-edit-plan.js';
import { choiceSetHash } from '#lib/domain/choice-end-card-hash.js';
import {
	CHOICE_END_CARD_LAYOUTS,
	CHOICE_END_CARD_TEMPLATE_IDS,
	choiceEndCardConfigSchema,
	type ChoiceEndCardLayout,
	type ChoiceEndCardTemplateId,
} from '#lib/schemas/choice-end-card.js';

const DEFAULT_CONFIG = {
	schemaVersion: 1 as const,
	templateId: 'doors' as const,
	layout: 'stacked' as const,
	durationMs: 6_000,
	prompt: 'Qual caminho você escolhe?',
	footer: 'Comente A ou B',
	reveal: 'progressive' as const,
	reducedMotion: false,
	sfx: 'beep' as const,
	sfxVolumeDb: -12,
	narration: 'mute' as const,
};

function messageFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof ChoiceEndCardError) return { status: cause.status, message: cause.message };
	if (cause instanceof VideoEditPlanError) return { status: cause.status, message: cause.message };
	if (cause instanceof EditPlanError) return { status: 400, message: cause.message };
	return { status: 503, message: 'Não foi possível processar o final A/B.' };
}

function readRevision(form: FormData): number | null {
	const raw = readFormText(form, 'expectedRevision');
	if (!/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function configFromForm(form: FormData) {
	return choiceEndCardConfigSchema.parse({
		schemaVersion: 1,
		templateId: readFormText(form, 'templateId') || DEFAULT_CONFIG.templateId,
		layout: readFormText(form, 'layout') || DEFAULT_CONFIG.layout,
		durationMs: Number(readFormText(form, 'durationMs') || DEFAULT_CONFIG.durationMs),
		prompt: readFormText(form, 'prompt'),
		footer: readFormText(form, 'footer'),
		reveal: readFormText(form, 'reveal') || DEFAULT_CONFIG.reveal,
		reducedMotion: readFormText(form, 'reducedMotion') === 'on',
		sfx: readFormText(form, 'sfx') || DEFAULT_CONFIG.sfx,
		sfxVolumeDb: Number(readFormText(form, 'sfxVolumeDb') || DEFAULT_CONFIG.sfxVolumeDb),
		narration: readFormText(form, 'narration') || DEFAULT_CONFIG.narration,
	});
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { episodes, selectedEpisode } = await loadOwnerEpisodeSelection(
		db,
		owner,
		event.url.searchParams.get('episodeId'),
	);
	if (!selectedEpisode)
		return {
			episodes,
			selectedEpisode: null,
			context: null,
			plan: null,
			notice: null,
			loadError: 'Crie um episódio para montar o final A/B.',
			defaults: DEFAULT_CONFIG,
			staleRevisionIds: [] as string[],
		};
	let context;
	try {
		context = await loadChoiceEndCardContext(db, owner, selectedEpisode.id);
	} catch (cause) {
		if (cause instanceof ChoiceEndCardError)
			return {
				episodes,
				selectedEpisode,
				context: null,
				plan: null,
				notice: null,
				loadError: cause.message,
				defaults: DEFAULT_CONFIG,
				staleRevisionIds: [] as string[],
			};
		throw cause;
	}
	if (!context)
		return {
			episodes,
			selectedEpisode,
			context: null,
			plan: null,
			notice: null,
			loadError: 'Episódio não encontrado.',
			defaults: DEFAULT_CONFIG,
			staleRevisionIds: [] as string[],
		};
	const currentHash = context.choices.length === 2 ? choiceSetHash(context.choices) : null;
	const staleRevisionIds = context.revisions
		.filter((revision) => choiceSetHash(revision.choices) !== currentHash)
		.map((revision) => revision.id);
	let plan: {
		version: number;
		status: string;
		endCardId: string | null;
		endCardRevision: number | null;
	} | null = null;
	try {
		const stored = await loadEditPlan(db, owner, selectedEpisode.id);
		if (stored.plan)
			plan = {
				version: stored.plan.current_version,
				status: stored.plan.current_status,
				endCardId: stored.plan.plan.endCard?.cardId ?? null,
				endCardRevision: stored.plan.plan.endCard?.cardRevision ?? null,
			};
	} catch {
		plan = null;
	}
	const generated = Number(event.url.searchParams.get('generated') ?? '');
	const approved = Number(event.url.searchParams.get('approved') ?? '');
	const restored = Number(event.url.searchParams.get('restored') ?? '');
	const attached = Number(event.url.searchParams.get('attached') ?? '');
	const detached = event.url.searchParams.get('detached') === '1';
	const notice =
		Number.isSafeInteger(generated) && generated > 0
			? { mode: 'generated' as const, value: generated }
			: Number.isSafeInteger(approved) && approved > 0
				? { mode: 'approved' as const, value: approved }
				: Number.isSafeInteger(restored) && restored > 0
					? { mode: 'restored' as const, value: restored }
					: Number.isSafeInteger(attached) && attached > 0
						? { mode: 'attached' as const, value: attached }
						: detached
							? { mode: 'detached' as const, value: 0 }
							: null;
	const latest = context.revisions[0]?.config;
	return {
		episodes,
		selectedEpisode,
		context,
		plan,
		notice,
		loadError:
			context.choices.length !== 2
				? context.episode.isFinale
					? 'Final de temporada sem escolhas: nenhuma CTA A/B será inventada.'
					: 'O episódio precisa de exatamente duas escolhas antes do final A/B.'
				: null,
		defaults: latest ? { ...DEFAULT_CONFIG, ...latest } : DEFAULT_CONFIG,
		staleRevisionIds,
	};
};

export const actions: Actions = {
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		let expectedRevision = readRevision(form);
		if (!episodeId || expectedRevision === null)
			return fail(400, { message: 'Episódio ou revisão inválidos. Recarregue a página.' });
		const layouts = form
			.getAll('layouts')
			.map(String)
			.filter((value): value is ChoiceEndCardLayout =>
				(CHOICE_END_CARD_LAYOUTS as readonly string[]).includes(value),
			);
		const templateId = readFormText(form, 'templateId');
		if (!(CHOICE_END_CARD_TEMPLATE_IDS as readonly string[]).includes(templateId))
			return fail(400, { message: 'Preset de final A/B inválido.' });
		const selected = layouts.length ? [...new Set(layouts)] : ['stacked' as const];
		try {
			for (const layout of selected) {
				const config = configFromForm(form);
				expectedRevision = await saveChoiceEndCard({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					episodeId,
					expectedRevision,
					config: { ...config, templateId: templateId as ChoiceEndCardTemplateId, layout },
				});
			}
			redirect(303, `/app/finale?episodeId=${episodeId}&generated=${selected.length}`);
		} catch (cause) {
			if (cause instanceof ChoiceEndCardError)
				return fail(cause.status, { message: cause.message });
			if (cause instanceof Error && cause.name === 'ZodError')
				return fail(400, { message: 'Prompt, rodapé, duração ou SFX inválidos.' });
			throw cause;
		}
	},
	approve: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const revisionId = readFormText(form, 'revisionId');
		const expectedRevision = readRevision(form);
		if (!revisionId || expectedRevision === null)
			return fail(400, { message: 'Revisão inválida.' });
		const revision = await loadChoiceEndCard(db, owner, revisionId);
		if (!revision) return fail(404, { message: 'Final A/B não encontrado.' });
		let version: number;
		try {
			version = await saveChoiceEndCard({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId: revision.episodeId,
				expectedRevision,
				config: revision.config,
				status: 'APPROVED',
			});
		} catch (cause) {
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
		redirect(303, `/app/finale?episodeId=${revision.episodeId}&approved=${version}`);
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const revisionId = readFormText(form, 'revisionId');
		const expectedRevision = readRevision(form);
		if (!revisionId || expectedRevision === null)
			return fail(400, { message: 'Revisão inválida.' });
		const revision = await loadChoiceEndCard(db, owner, revisionId);
		if (!revision) return fail(404, { message: 'Final A/B não encontrado.' });
		let version: number;
		try {
			version = await saveChoiceEndCard({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId: revision.episodeId,
				expectedRevision,
				config: revision.config,
			});
		} catch (cause) {
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
		redirect(303, `/app/finale?episodeId=${revision.episodeId}&restored=${version}`);
	},
	attach: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const revisionId = readFormText(form, 'revisionId');
		const episodeId = readFormText(form, 'episodeId');
		const expectedVersionRaw = readFormText(form, 'expectedVersion');
		if (!revisionId || !episodeId || !/^\d+$/.test(expectedVersionRaw))
			return fail(400, { message: 'Revisão ou versão da timeline inválida.' });
		const revision = await loadChoiceEndCard(db, owner, revisionId);
		if (!revision) return fail(404, { message: 'Final A/B não encontrado.' });
		let version: number;
		try {
			const planContext = await loadEditPlanContext(db, owner, episodeId);
			const stored = await loadEditPlan(db, owner, episodeId);
			const base = stored.plan?.plan ?? defaultEditPlan(planContext);
			const endMs = base.durationMs;
			const startMs = Math.max(0, endMs - revision.config.durationMs);
			version = await saveVideoEditPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion: stored.plan?.current_version ?? 0,
				plan: {
					...base,
					episodeRevisionNumber: planContext.episodeRevisionNumber,
					endCard: {
						...revision.config,
						cardId: revision.id,
						cardRevision: revision.revision,
						choiceRevisionNumber: revision.choiceRevisionNumber,
						startMs,
						endMs,
						choices: revision.choices,
					},
				},
				changeNote: `Final A/B anexado na revisão ${revision.revision}`,
			});
		} catch (cause) {
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
		redirect(303, `/app/finale?episodeId=${episodeId}&attached=${version}`);
	},
	detach: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const expectedVersionRaw = readFormText(form, 'expectedVersion');
		if (!episodeId || !/^\d+$/.test(expectedVersionRaw))
			return fail(400, { message: 'Episódio ou versão inválida.' });
		let version: number;
		try {
			const stored = await loadEditPlan(db, owner, episodeId);
			if (!stored.plan) return fail(404, { message: 'Timeline ainda não existe.' });
			version = await saveVideoEditPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion: Number(expectedVersionRaw),
				plan: { ...stored.plan.plan, endCard: null },
				changeNote: 'Final A/B removido da timeline',
			});
		} catch (cause) {
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
		redirect(303, `/app/finale?episodeId=${episodeId}&detached=1&version=${version}`);
	},
};
