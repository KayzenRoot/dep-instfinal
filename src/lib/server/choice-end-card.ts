import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	choiceEndCardChoicesSchema,
	choiceEndCardConfigSchema,
	type ChoiceEndCardChoice,
	type ChoiceEndCardConfig,
	type EditPlanEndCard,
} from '#lib/schemas/choice-end-card.js';
import { buildEndCardAss, EndCardError } from '#lib/domain/choice-end-card.js';
import { choiceEndCardConfigHash, choiceSetHash } from '#lib/domain/choice-end-card-hash.js';
import { PLATFORM_PREVIEW_PROFILES } from '#lib/domain/platform-preview.js';
import { firstRelation } from './relations.js';

export class ChoiceEndCardError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'ChoiceEndCardError';
	}
}

interface ChoiceEndCardRow {
	id: string;
	episode_id: string;
	revision_number: number;
	choice_revision_number: number;
	choices_snapshot: unknown;
	config: unknown;
	config_hash: string;
	hash_version: number;
	status: string;
	created_at: string;
}

export interface ChoiceEndCardRevision {
	id: string;
	episodeId: string;
	revision: number;
	choiceRevisionNumber: number;
	choices: ChoiceEndCardChoice[];
	config: ChoiceEndCardConfig;
	status: 'DRAFT' | 'APPROVED';
	hashVersion: number;
	createdAt: string;
}

export interface ChoiceEndCardContext {
	episode: {
		id: string;
		title: string;
		number: number;
		durationMs: number;
		status: string;
		isFinale: boolean;
		seriesTitle: string;
	};
	choices: ChoiceEndCardChoice[];
	choiceRevisionNumber: number;
	revisions: ChoiceEndCardRevision[];
	latestRevision: number;
}

function parseRevision(row: ChoiceEndCardRow): ChoiceEndCardRevision {
	const config = choiceEndCardConfigSchema.safeParse(row.config);
	const choices = choiceEndCardChoicesSchema.safeParse(row.choices_snapshot);
	if (!config.success || !choices.success)
		throw new ChoiceEndCardError(
			500,
			'END_CARD_STORED_INVALID',
			'Configuração de final A/B armazenada é inválida.',
		);
	let hash: string;
	try {
		hash = choiceEndCardConfigHash(config.data, choices.data, Number(row.hash_version));
	} catch (cause) {
		if (cause instanceof EndCardError) throw new ChoiceEndCardError(500, cause.code, cause.message);
		throw cause;
	}
	if (hash !== row.config_hash)
		throw new ChoiceEndCardError(
			500,
			'END_CARD_HASH_MISMATCH',
			'O hash do final A/B armazenado não confere.',
		);
	if (row.status !== 'DRAFT' && row.status !== 'APPROVED')
		throw new ChoiceEndCardError(500, 'END_CARD_STORED_INVALID', 'Status armazenado inválido.');
	return {
		id: row.id,
		episodeId: row.episode_id,
		revision: Number(row.revision_number),
		choiceRevisionNumber: Number(row.choice_revision_number),
		choices: choices.data,
		config: config.data,
		status: row.status,
		hashVersion: Number(row.hash_version),
		createdAt: row.created_at,
	};
}

function choiceEquals(left: ChoiceEndCardChoice[], right: ChoiceEndCardChoice[]): boolean {
	return choiceSetHash(left) === choiceSetHash(right);
}

function mapRpcError(error: { code?: string; message?: string }): ChoiceEndCardError {
	if (error.code === '40001')
		return new ChoiceEndCardError(
			409,
			'END_CARD_REVISION_CONFLICT',
			'O final A/B foi alterado em outra aba. Recarregue antes de salvar.',
		);
	if (error.code === 'P0002')
		return new ChoiceEndCardError(404, 'END_CARD_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	if (error.code === '55000')
		return new ChoiceEndCardError(
			409,
			'END_CARD_EPISODE_PUBLISHED',
			'Episódio publicado não aceita um novo final A/B.',
		);
	if (error.code === '23514' && error.message?.includes('end_card_requires_two_choices'))
		return new ChoiceEndCardError(
			409,
			'END_CARD_REQUIRES_TWO_CHOICES',
			'O final A/B exige exatamente duas escolhas aprovadas; finais sem escolha não recebem CTA inventada.',
		);
	if (error.code === '23514' && error.message?.includes('choice_end_card_quota'))
		return new ChoiceEndCardError(
			409,
			'END_CARD_QUOTA',
			'Limite de 200 revisões de final A/B atingido. Um operador pode podar o histórico antigo.',
		);
	if (error.code === '23514')
		return new ChoiceEndCardError(400, 'END_CARD_INVALID', 'Configuração do final A/B inválida.');
	if (error.code === '42501')
		return new ChoiceEndCardError(403, 'END_CARD_FORBIDDEN', 'Acesso não autorizado.');
	return new ChoiceEndCardError(
		503,
		'END_CARD_SAVE_FAILED',
		'Não foi possível salvar o final A/B.',
	);
}

export async function loadChoiceEndCardContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<ChoiceEndCardContext | null> {
	const [episodeResult, choicesResult, revisionsResult, revisionResult] = await Promise.all([
		db
			.from('episodes')
			.select(
				'id,title,episode_number,duration_ms,status,seasons(planned_episode_count,series(title))',
			)
			.eq('owner_id', owner.id)
			.eq('id', episodeId)
			.maybeSingle(),
		db
			.from('choices')
			.select('id,option_key,label')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('option_key'),
		db
			.from('choice_end_cards')
			.select(
				'id,episode_id,revision_number,choice_revision_number,choices_snapshot,config,config_hash,hash_version,status,created_at',
			)
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('revision_number', { ascending: false })
			.limit(30),
		db
			.from('episode_revisions')
			.select('revision_number')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	if (episodeResult.error)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_LOAD_FAILED',
			'Não foi possível carregar o episódio.',
		);
	if (!episodeResult.data) return null;
	if (choicesResult.error || revisionsResult.error || revisionResult.error)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_LOAD_FAILED',
			'Não foi possível carregar o final A/B.',
		);
	const season = firstRelation(episodeResult.data.seasons);
	const planned = Number(
		(season as { planned_episode_count?: number } | null)?.planned_episode_count ?? 0,
	);
	const number = Number(episodeResult.data.episode_number);
	const rawChoices = (choicesResult.data ?? []).map((choice) => {
		const parsed = choiceEndCardChoicesSchema.element.safeParse({
			id: choice.id,
			optionKey: choice.option_key,
			label: choice.label,
		});
		if (!parsed.success)
			throw new ChoiceEndCardError(
				500,
				'END_CARD_CHOICES_INVALID',
				'As escolhas do episódio não formam um par A/B válido.',
			);
		return parsed.data;
	});
	const revisions = ((revisionsResult.data ?? []) as ChoiceEndCardRow[]).map(parseRevision);
	return {
		episode: {
			id: episodeResult.data.id as string,
			title: episodeResult.data.title as string,
			number,
			durationMs: Number(episodeResult.data.duration_ms),
			status: episodeResult.data.status as string,
			isFinale: planned > 0 && number === planned,
			seriesTitle:
				((season as { series?: unknown } | null)?.series as { title?: string } | null)?.title ??
				'Série',
		},
		choices: rawChoices.length === 2 ? rawChoices : [],
		choiceRevisionNumber:
			typeof revisionResult.data?.revision_number === 'number'
				? Number(revisionResult.data.revision_number)
				: 1,
		revisions,
		latestRevision: revisions[0]?.revision ?? 0,
	};
}

export async function loadChoiceEndCard(
	db: SupabaseClient,
	owner: User,
	revisionId: string,
): Promise<ChoiceEndCardRevision | null> {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(revisionId))
		return null;
	const { data, error } = await db
		.from('choice_end_cards')
		.select(
			'id,episode_id,revision_number,choice_revision_number,choices_snapshot,config,config_hash,hash_version,status,created_at',
		)
		.eq('owner_id', owner.id)
		.eq('id', revisionId)
		.maybeSingle();
	if (error)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_LOAD_FAILED',
			'Não foi possível carregar o final A/B.',
		);
	return data ? parseRevision(data as ChoiceEndCardRow) : null;
}

export async function saveChoiceEndCard(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedRevision: number;
	config: ChoiceEndCardConfig;
	status?: 'DRAFT' | 'APPROVED';
}): Promise<number> {
	const context = await loadChoiceEndCardContext(input.db, input.owner, input.episodeId);
	if (!context)
		throw new ChoiceEndCardError(404, 'END_CARD_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	if (context.choices.length !== 2)
		throw new ChoiceEndCardError(
			409,
			'END_CARD_REQUIRES_TWO_CHOICES',
			context.episode.isFinale
				? 'Final de temporada sem escolhas não recebe CTA A/B; finalize sem votação.'
				: 'O episódio precisa de exatamente duas escolhas para gerar o final A/B.',
		);
	const config = choiceEndCardConfigSchema.safeParse(input.config);
	if (!config.success)
		throw new ChoiceEndCardError(400, 'END_CARD_INVALID', 'Configuração do final A/B inválida.');
	try {
		buildEndCardAss(
			{
				...config.data,
				cardId: '00000000-0000-4000-8000-000000000000',
				cardRevision: 1,
				choiceRevisionNumber: context.choiceRevisionNumber,
				startMs: 0,
				endMs: config.data.durationMs,
				choices: context.choices,
			},
			PLATFORM_PREVIEW_PROFILES.tiktok.safeArea,
		);
	} catch (cause) {
		if (cause instanceof EndCardError) throw new ChoiceEndCardError(400, cause.code, cause.message);
		throw cause;
	}
	if (!input.adminDb)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_WRITE_UNAVAILABLE',
			'O writer do final A/B não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_choice_end_card', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_revision: input.expectedRevision,
		p_config: config.data,
		p_config_hash: choiceEndCardConfigHash(config.data, context.choices),
		p_status: input.status ?? 'DRAFT',
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new ChoiceEndCardError(503, 'END_CARD_SAVE_FAILED', 'O servidor não retornou a revisão.');
	return data;
}

export async function loadApprovedEndCardSnapshot(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	cardId: string;
	cardRevision: number;
}): Promise<{
	card: ChoiceEndCardRevision;
	choices: ChoiceEndCardChoice[];
	stale: boolean;
}> {
	const { data, error } = await input.db
		.from('choice_end_cards')
		.select(
			'id,episode_id,revision_number,choice_revision_number,choices_snapshot,config,config_hash,hash_version,status,created_at',
		)
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('id', input.cardId)
		.eq('revision_number', input.cardRevision)
		.maybeSingle();
	if (error)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_LOAD_FAILED',
			'Não foi possível carregar o final A/B.',
		);
	if (!data)
		throw new ChoiceEndCardError(404, 'END_CARD_NOT_FOUND', 'Revisão de final A/B não encontrada.');
	const card = parseRevision(data as ChoiceEndCardRow);
	if (card.status !== 'APPROVED')
		throw new ChoiceEndCardError(
			409,
			'END_CARD_NOT_APPROVED',
			'Aprove o final A/B antes de anexá-lo à timeline.',
		);
	const { data: currentRows, error: choicesError } = await input.db
		.from('choices')
		.select('id,option_key,label')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.order('option_key');
	if (choicesError)
		throw new ChoiceEndCardError(
			503,
			'END_CARD_LOAD_FAILED',
			'Não foi possível validar as escolhas atuais.',
		);
	const current: ChoiceEndCardChoice[] = [];
	for (const row of currentRows ?? []) {
		const parsed = choiceEndCardChoicesSchema.element.safeParse({
			id: row.id,
			optionKey: row.option_key,
			label: row.label,
		});
		if (!parsed.success)
			throw new ChoiceEndCardError(
				409,
				'END_CARD_CHOICES_INVALID',
				'O episódio não tem um par de escolhas A/B válido.',
			);
		current.push(parsed.data);
	}
	if (current.length !== 2 || !choiceEquals(card.choices, current))
		throw new ChoiceEndCardError(
			409,
			'END_CARD_STALE',
			'As escolhas ou o roteiro mudaram. Revise e aprove um novo final A/B.',
		);
	return { card, choices: current, stale: false };
}

export function buildPlanEndCardSnapshot(input: {
	card: ChoiceEndCardRevision;
	choices: ChoiceEndCardChoice[];
	startMs: number;
	endMs: number;
}): EditPlanEndCard {
	return {
		...input.card.config,
		cardId: input.card.id,
		cardRevision: input.card.revision,
		choiceRevisionNumber: input.card.choiceRevisionNumber,
		startMs: input.startMs,
		endMs: input.endMs,
		choices: input.choices,
	};
}
