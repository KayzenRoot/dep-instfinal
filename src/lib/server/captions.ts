import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	buildCaptionAss,
	buildCaptionSrt,
	buildCaptionTrack,
	CaptionError,
	type AsrWordInput,
	type ScriptSegment,
} from '#lib/domain/captions.js';
import { captionTrackSchema, type CaptionStyle, type CaptionTrack } from '#lib/schemas/captions.js';
import { videoEditPlanSchema, type VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

export class CaptionServiceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'CaptionServiceError';
	}
}

export interface CaptionContext {
	episodeId: string;
	episodeRevisionNumber: number | null;
	durationMs: number;
	plan: VideoEditPlan;
	planId: string;
	planVersion: number;
	planStatus: 'DRAFT' | 'APPROVED' | 'RENDERED';
	narrationTakeId: string | null;
	audioSha256: string | null;
	segments: ScriptSegment[];
}

export interface StoredCaptionTrack {
	track: CaptionTrack;
	currentVersion: number;
	status: 'DRAFT' | 'APPROVED';
	versions: Array<{ version: number; createdAt: string; note: string; hash: string }>;
}

function canonicalJson(value: unknown): string {
	const sort = (entry: unknown): unknown => {
		if (Array.isArray(entry)) return entry.map(sort);
		if (entry && typeof entry === 'object') {
			return Object.fromEntries(
				Object.entries(entry as Record<string, unknown>)
					.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
					.map(([key, child]) => [key, sort(child)]),
			);
		}
		return entry;
	};
	return JSON.stringify(sort(value));
}

export function captionTrackHash(track: CaptionTrack): string {
	return createHash('sha256').update(canonicalJson(track)).digest('hex');
}

function splitNarration(text: string): ScriptSegment[] {
	return text
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean)
		.map((sentence, index) => ({ index, text: sentence }));
}

export async function loadCaptionContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
	requestedVersion?: number | null,
): Promise<CaptionContext> {
	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select('id,duration_ms,narration_pt_br')
		.eq('id', episodeId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (episodeError || !episode)
		throw new CaptionServiceError(404, 'CAPTION_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	const [{ data: planRow, error: planError }, { data: revision }] = await Promise.all([
		db
			.from('video_edit_plans')
			.select('id,current_version,current_status')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.maybeSingle(),
		db
			.from('episode_revisions')
			.select('revision_number')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	if (planError || !planRow)
		throw new CaptionServiceError(
			409,
			'CAPTION_PLAN_NOT_FOUND',
			'Aprove um plano de edição primeiro.',
		);
	const planVersion = requestedVersion ?? planRow.current_version;
	const { data: versionRow, error: versionError } = await db
		.from('video_edit_plan_versions')
		.select('plan')
		.eq('owner_id', owner.id)
		.eq('plan_id', planRow.id)
		.eq('version', planVersion)
		.maybeSingle();
	if (versionError || !versionRow)
		throw new CaptionServiceError(
			404,
			'CAPTION_PLAN_VERSION_NOT_FOUND',
			'Versão do plano não encontrada.',
		);
	const parsedPlan = videoEditPlanSchema.safeParse(versionRow.plan);
	if (!parsedPlan.success)
		throw new CaptionServiceError(
			500,
			'CAPTION_PLAN_INVALID',
			'O plano de edição armazenado é inválido.',
		);
	const [{ data: voicePlan }, { data: latestTake }] = await Promise.all([
		db
			.from('voice_direction_plans')
			.select('plan,current_status')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.maybeSingle(),
		db
			.from('narration_takes')
			.select('id,sha256,duration_ms')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.eq('status', 'READY')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	const plannedTake =
		voicePlan?.current_status === 'APPROVED'
			? ((voicePlan.plan as { takeId?: unknown } | null)?.takeId ?? null)
			: null;
	const takeId = typeof plannedTake === 'string' ? plannedTake : (latestTake?.id ?? null);
	let audioSha256 = latestTake?.sha256 ?? null;
	if (takeId && takeId !== latestTake?.id) {
		const { data: selected } = await db
			.from('narration_takes')
			.select('sha256')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.eq('id', takeId)
			.eq('status', 'READY')
			.maybeSingle();
		audioSha256 = selected?.sha256 ?? null;
	}
	const voiceSegments =
		voicePlan?.current_status === 'APPROVED'
			? ((voicePlan.plan as { segments?: Array<{ text?: string; sceneId?: string | null }> } | null)
					?.segments ?? [])
			: [];
	const segments = voiceSegments.length
		? voiceSegments.map((segment, index) => ({
				index,
				text: String(segment.text ?? '').trim(),
				sceneId: segment.sceneId ?? null,
			}))
		: splitNarration(String(episode.narration_pt_br ?? ''));
	if (!segments.some((segment) => segment.text))
		throw new CaptionServiceError(
			409,
			'CAPTION_SCRIPT_EMPTY',
			'O episódio não tem narração para legendar.',
		);
	return {
		episodeId,
		episodeRevisionNumber:
			typeof revision?.revision_number === 'number' ? revision.revision_number : null,
		durationMs: Number(episode.duration_ms),
		plan: parsedPlan.data,
		planId: planRow.id,
		planVersion,
		planStatus: planRow.current_status,
		narrationTakeId: takeId,
		audioSha256,
		segments,
	};
}

export async function loadCaptionTrack(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
	planVersion?: number,
): Promise<StoredCaptionTrack | null> {
	const { data, error } = await db
		.from('caption_tracks')
		.select('track,current_version,current_status,versions')
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.eq('plan_version', planVersion ?? -1)
		.maybeSingle();
	if (error)
		throw new CaptionServiceError(
			503,
			'CAPTION_LOAD_FAILED',
			'Não foi possível carregar as legendas.',
		);
	if (!data) return null;
	const parsed = captionTrackSchema.safeParse(data.track);
	if (!parsed.success)
		throw new CaptionServiceError(500, 'CAPTION_INVALID', 'A legenda armazenada é inválida.');
	return {
		track: parsed.data,
		currentVersion: data.current_version as number,
		status: data.current_status as 'DRAFT' | 'APPROVED',
		versions: Array.isArray(data.versions) ? (data.versions as StoredCaptionTrack['versions']) : [],
	};
}

function validateTrackAgainstContext(track: CaptionTrack, context: CaptionContext): CaptionTrack {
	if (track.episodeId !== context.episodeId)
		throw new CaptionServiceError(
			409,
			'CAPTION_EPISODE_MISMATCH',
			'A legenda é de outro episódio.',
		);
	if (track.planId !== context.planId || track.planVersion !== context.planVersion)
		throw new CaptionServiceError(409, 'CAPTION_PLAN_MISMATCH', 'A legenda é de outro plano.');
	if (track.narrationTakeId !== context.narrationTakeId)
		throw new CaptionServiceError(409, 'CAPTION_TAKE_MISMATCH', 'A legenda usa outra narração.');
	if (track.audioSha256 && context.audioSha256 && track.audioSha256 !== context.audioSha256)
		throw new CaptionServiceError(409, 'CAPTION_AUDIO_MISMATCH', 'O áudio da legenda mudou.');
	for (const cue of track.cues) {
		if (cue.endMs > context.durationMs)
			throw new CaptionServiceError(
				400,
				'CAPTION_CUE_OUT_OF_RANGE',
				'Cue fora da duração do vídeo.',
			);
	}
	return track;
}

export async function saveCaptionTrack(input: {
	adminDb: SupabaseClient | null;
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion: number;
	expectedVersion: number;
	track: CaptionTrack;
	changeNote?: string;
	status?: 'DRAFT' | 'APPROVED';
}): Promise<number> {
	if (!input.adminDb)
		throw new CaptionServiceError(
			503,
			'CAPTION_WRITER_UNAVAILABLE',
			'O writer de legendas não está configurado.',
		);
	const context = await loadCaptionContext(
		input.db,
		input.owner,
		input.episodeId,
		input.planVersion,
	);
	let track = validateTrackAgainstContext(input.track, context);
	if (!track.scriptSha256)
		track = {
			...track,
			scriptSha256: createHash('sha256')
				.update(context.segments.map((segment) => segment.text).join(' '))
				.digest('hex'),
		};
	if (!track.audioSha256 && context.audioSha256)
		track = { ...track, audioSha256: context.audioSha256 };
	if (input.status === 'APPROVED' && track.cues.length === 0)
		throw new CaptionServiceError(
			400,
			'CAPTION_CUES_REQUIRED',
			'Adicione pelo menos uma cue antes de aprovar.',
		);
	const hash = captionTrackHash(track);
	const { data: existing, error: existingError } = await input.adminDb
		.from('caption_tracks')
		.select('id,current_version,versions')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('plan_version', input.planVersion)
		.maybeSingle();
	if (existingError)
		throw new CaptionServiceError(
			503,
			'CAPTION_SAVE_FAILED',
			'Não foi possível salvar as legendas.',
		);
	if (!existing) {
		if (input.expectedVersion !== 0)
			throw new CaptionServiceError(409, 'CAPTION_CONFLICT', 'As legendas mudaram. Recarregue.');
		const versions = [
			{
				version: 1,
				createdAt: new Date().toISOString(),
				note: input.changeNote ?? '',
				hash,
				track,
			},
		];
		const { error } = await input.adminDb.from('caption_tracks').insert({
			owner_id: input.owner.id,
			episode_id: input.episodeId,
			edit_plan_id: context.planId,
			plan_version: context.planVersion,
			narration_take_id: context.narrationTakeId,
			current_version: 1,
			current_status: input.status ?? 'DRAFT',
			track,
			versions,
			script_sha256: track.scriptSha256,
			audio_sha256: track.audioSha256,
		});
		if (error)
			throw new CaptionServiceError(
				503,
				'CAPTION_SAVE_FAILED',
				'Não foi possível salvar as legendas.',
			);
		return 1;
	}
	if (existing.current_version !== input.expectedVersion)
		throw new CaptionServiceError(409, 'CAPTION_CONFLICT', 'As legendas mudaram. Recarregue.');
	const version = existing.current_version + 1;
	const versions = [
		...(Array.isArray(existing.versions) ? existing.versions : []),
		{ version, createdAt: new Date().toISOString(), note: input.changeNote ?? '', hash, track },
	].slice(-50);
	const { data: updated, error } = await input.adminDb
		.from('caption_tracks')
		.update({
			track,
			versions,
			current_version: version,
			current_status: input.status ?? 'DRAFT',
			narration_take_id: context.narrationTakeId,
			script_sha256: track.scriptSha256,
			audio_sha256: track.audioSha256,
		})
		.eq('owner_id', input.owner.id)
		.eq('id', existing.id)
		.eq('current_version', input.expectedVersion)
		.select('current_version')
		.maybeSingle();
	if (error || !updated)
		throw new CaptionServiceError(409, 'CAPTION_CONFLICT', 'As legendas mudaram. Recarregue.');
	return version;
}

function wrapCtaText(text: string): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of text.trim().split(/\s+/)) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > 42 && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) lines.push(current);
	const chunks: string[] = [];
	for (let index = 0; index < lines.length; index += 2)
		chunks.push(lines.slice(index, index + 2).join('\n'));
	return chunks;
}

export async function generateCaptionTrack(input: {
	adminDb: SupabaseClient | null;
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion: number;
	expectedVersion: number;
	asrWords: AsrWordInput[];
	style?: CaptionStyle;
	safeZone?: CaptionTrack['safeZone'];
	changeNote?: string;
	status?: 'DRAFT' | 'APPROVED';
}): Promise<{ version: number; track: CaptionTrack }> {
	const context = await loadCaptionContext(
		input.db,
		input.owner,
		input.episodeId,
		input.planVersion,
	);
	const track = buildCaptionTrack({
		episodeId: context.episodeId,
		planId: context.planId,
		planVersion: context.planVersion,
		narrationTakeId: context.narrationTakeId,
		durationMs: context.durationMs,
		segments: context.segments,
		asrWords: input.asrWords,
		style: input.style,
		safeZone: input.safeZone,
		audioSha256: context.audioSha256,
	});
	if (context.plan.cta?.enabled && context.plan.cta.text) {
		const previous = track.cues.at(-1);
		const startMs = Math.max(previous?.endMs ?? context.plan.cta.startMs, context.plan.cta.startMs);
		const endMs = Math.min(context.durationMs, Math.max(startMs + 300, context.plan.cta.endMs));
		const chunks = wrapCtaText(context.plan.cta.text);
		if (endMs - startMs >= 300 && chunks.length) {
			const slot = Math.max(300, Math.floor((endMs - startMs) / chunks.length));
			for (const [index, text] of chunks.entries()) {
				const cueStart = Math.min(endMs - 300, startMs + index * slot);
				const cueEnd = Math.min(endMs, cueStart + slot);
				if (cueEnd - cueStart < 300) continue;
				track.cues.push({
					id: crypto.randomUUID(),
					startMs: cueStart,
					endMs: cueEnd,
					text,
					words: [],
				});
			}
		}
	}
	const version = await saveCaptionTrack({
		adminDb: input.adminDb,
		db: input.db,
		owner: input.owner,
		episodeId: input.episodeId,
		planVersion: input.planVersion,
		expectedVersion: input.expectedVersion,
		track,
		changeNote: input.changeNote,
		status: input.status,
	});
	return { version, track };
}

export async function restoreCaptionTrack(input: {
	adminDb: SupabaseClient | null;
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion: number;
	version: number;
	expectedVersion: number;
}): Promise<number> {
	const { data, error } = await input.db
		.from('caption_tracks')
		.select('current_version,versions')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('plan_version', input.planVersion)
		.maybeSingle();
	if (error || !data)
		throw new CaptionServiceError(404, 'CAPTION_NOT_FOUND', 'Legendas não encontradas.');
	if (data.current_version !== input.expectedVersion)
		throw new CaptionServiceError(409, 'CAPTION_CONFLICT', 'As legendas mudaram. Recarregue.');
	const versions = Array.isArray(data.versions) ? data.versions : [];
	const snapshot = versions.find(
		(entry: { version?: number }) => entry.version === input.version,
	)?.track;
	const parsed = captionTrackSchema.safeParse(snapshot);
	if (!parsed.success)
		throw new CaptionServiceError(
			409,
			'CAPTION_VERSION_UNAVAILABLE',
			'Versão sem snapshot restaurável.',
		);
	return saveCaptionTrack({
		adminDb: input.adminDb,
		db: input.db,
		owner: input.owner,
		episodeId: input.episodeId,
		planVersion: input.planVersion,
		expectedVersion: input.expectedVersion,
		track: parsed.data,
		changeNote: `Restauração da versão ${input.version}`,
	});
}

export async function getCaptionExports(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion?: number | null;
}): Promise<{ srt: string; ass: string } | null> {
	const planVersion =
		input.planVersion && input.planVersion > 0
			? input.planVersion
			: (await loadCaptionContext(input.db, input.owner, input.episodeId)).planVersion;
	const stored = await loadCaptionTrack(input.db, input.owner, input.episodeId, planVersion);
	if (!stored) return null;
	return {
		srt: buildCaptionSrt(stored.track.cues),
		ass: buildCaptionAss(stored.track),
	};
}

export async function getApprovedCaptionTrack(input: {
	db: SupabaseClient;
	ownerId: string;
	episodeId: string;
	planVersion: number;
}): Promise<CaptionTrack | null> {
	const { data, error } = await input.db
		.from('caption_tracks')
		.select('track')
		.eq('owner_id', input.ownerId)
		.eq('episode_id', input.episodeId)
		.eq('plan_version', input.planVersion)
		.eq('current_status', 'APPROVED')
		.maybeSingle();
	if (error)
		throw new CaptionServiceError(
			503,
			'CAPTION_LOAD_FAILED',
			'Não foi possível carregar as legendas.',
		);
	if (!data) return null;
	const parsed = captionTrackSchema.safeParse(data.track);
	if (!parsed.success)
		throw new CaptionServiceError(500, 'CAPTION_INVALID', 'A legenda aprovada é inválida.');
	return parsed.data;
}

export function captionErrorResponse(cause: unknown): CaptionServiceError {
	if (cause instanceof CaptionServiceError) return cause;
	if (cause instanceof CaptionError) return new CaptionServiceError(400, cause.code, cause.message);
	return new CaptionServiceError(503, 'CAPTION_FAILED', 'Não foi possível processar as legendas.');
}
