import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { VideoStorage } from './video-storage.js';
import { mediaProcessEnv } from './video-probe.js';
import {
	buildHeuristicVoicePlan,
	estimateSpeechDurationMs,
	narrationTextHash,
	validateVoicePlan,
	VoiceDirectionError,
	type VoiceContext,
} from '#lib/domain/voice-direction.js';
import { voiceDirectionPlanSchema, type VoiceDirectionPlan } from '#lib/schemas/voice-direction.js';

const execFileAsync = promisify(execFile);

export class NarrationError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'NarrationError';
	}
}

export interface AudioMetadata {
	durationMs: number;
	format: string;
	sampleRate: number;
	channels: number;
	peakDb: number | null;
	rmsDb: number | null;
	truePeakDb: number | null;
	lufs: number | null;
}

export interface NarrationTake {
	id: string;
	episode_id: string;
	plan_version: number;
	source: 'UPLOAD' | 'TTS';
	status: 'READY' | 'REJECTED';
	sha256: string;
	byte_size: number;
	duration_ms: number;
	format: string;
	sample_rate: number;
	channels: number;
	peak_db: number | null;
	rms_db: number | null;
	true_peak_db: number | null;
	lufs: number | null;
	model_id: string | null;
	model_license: string | null;
	model_sha256: string | null;
	created_at: string;
}

export interface StoredVoicePlan {
	plan: VoiceDirectionPlan;
	currentVersion: number;
	status: 'DRAFT' | 'APPROVED';
	versions: Array<{
		version: number;
		createdAt: string;
		note: string;
		hash: string;
		plan?: VoiceDirectionPlan;
	}>;
	estimatedDurationMs: number;
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

export function voicePlanHash(plan: VoiceDirectionPlan): string {
	return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

export async function loadVoiceContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<VoiceContext> {
	const [episodeResult, scenesResult, revisionResult] = await Promise.all([
		db
			.from('episodes')
			.select('id,narration_pt_br,duration_ms,status')
			.eq('id', episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle(),
		db
			.from('scenes')
			.select('id,scene_index')
			.eq('episode_id', episodeId)
			.eq('owner_id', owner.id)
			.order('scene_index'),
		db
			.from('episode_revisions')
			.select('revision_number')
			.eq('episode_id', episodeId)
			.eq('owner_id', owner.id)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	if (episodeResult.error || !episodeResult.data)
		throw new NarrationError(404, 'NARRATION_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	if (scenesResult.error || revisionResult.error)
		throw new NarrationError(
			503,
			'NARRATION_CONTEXT_FAILED',
			'Não foi possível carregar a narração.',
		);
	return {
		episodeId,
		episodeRevisionNumber:
			typeof revisionResult.data?.revision_number === 'number'
				? revisionResult.data.revision_number
				: null,
		narrationPtBr: String(episodeResult.data.narration_pt_br ?? ''),
		scenes: (scenesResult.data ?? []).map((scene) => ({
			id: scene.id as string,
			sceneIndex: scene.scene_index as number,
		})),
	};
}

export function heuristicVoicePlan(context: VoiceContext): VoiceDirectionPlan {
	return buildHeuristicVoicePlan(context);
}

export async function loadVoicePlan(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<StoredVoicePlan | null> {
	const { data, error } = await db
		.from('voice_direction_plans')
		.select('plan,current_version,current_status,versions')
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.maybeSingle();
	if (error)
		throw new NarrationError(
			503,
			'NARRATION_PLAN_LOAD_FAILED',
			'Não foi possível carregar o plano.',
		);
	if (!data) return null;
	const parsed = voiceDirectionPlanSchema.safeParse(data.plan);
	if (!parsed.success)
		throw new NarrationError(
			500,
			'NARRATION_PLAN_INVALID',
			'O plano de narração armazenado é inválido.',
		);
	return {
		plan: parsed.data,
		currentVersion: data.current_version as number,
		status: data.current_status as 'DRAFT' | 'APPROVED',
		versions: Array.isArray(data.versions) ? (data.versions as StoredVoicePlan['versions']) : [],
		estimatedDurationMs: estimateSpeechDurationMs(parsed.data),
	};
}

export async function saveVoicePlan(input: {
	adminDb: SupabaseClient | null;
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	expectedVersion: number;
	plan: VoiceDirectionPlan;
	changeNote?: string;
	status?: 'DRAFT' | 'APPROVED';
}): Promise<number> {
	if (!input.adminDb)
		throw new NarrationError(
			503,
			'NARRATION_WRITER_UNAVAILABLE',
			'O writer de narração não está configurado.',
		);
	const context = await loadVoiceContext(input.db, input.owner, input.episodeId);
	let plan: VoiceDirectionPlan;
	try {
		plan = validateVoicePlan(input.plan, context);
		if (!plan.narrationTextSha256)
			plan = { ...plan, narrationTextSha256: narrationTextHash(context.narrationPtBr) };
		plan = { ...plan, episodeRevisionNumber: context.episodeRevisionNumber };
	} catch (cause) {
		if (cause instanceof VoiceDirectionError)
			throw new NarrationError(
				cause.code === 'VOICE_PLAN_STALE' ? 409 : 400,
				cause.code,
				cause.message,
			);
		throw cause;
	}
	if (input.status === 'APPROVED' && !plan.takeId)
		throw new NarrationError(
			400,
			'NARRATION_TAKE_REQUIRED',
			'Selecione e envie uma voz antes de aprovar a narração.',
		);
	if (plan.takeId) {
		const { data: take, error } = await input.adminDb
			.from('narration_takes')
			.select('id,status')
			.eq('owner_id', input.owner.id)
			.eq('episode_id', input.episodeId)
			.eq('id', plan.takeId)
			.maybeSingle();
		if (error || !take || take.status !== 'READY')
			throw new NarrationError(
				409,
				'NARRATION_TAKE_NOT_READY',
				'A voz selecionada não está pronta.',
			);
	}
	const hash = voicePlanHash(plan);
	const { data: existing, error: existingError } = await input.adminDb
		.from('voice_direction_plans')
		.select('id,current_version,versions')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.maybeSingle();
	if (existingError)
		throw new NarrationError(503, 'NARRATION_PLAN_SAVE_FAILED', 'Não foi possível salvar o plano.');
	if (!existing) {
		if (input.expectedVersion !== 0)
			throw new NarrationError(409, 'NARRATION_PLAN_CONFLICT', 'O plano foi alterado. Recarregue.');
		const version = 1;
		const versions = [
			{
				version,
				createdAt: new Date().toISOString(),
				note: input.changeNote ?? '',
				hash,
				plan,
			},
		];
		const { error } = await input.adminDb.from('voice_direction_plans').insert({
			owner_id: input.owner.id,
			episode_id: input.episodeId,
			current_version: version,
			current_status: input.status ?? 'DRAFT',
			plan,
			versions,
		});
		if (error)
			throw new NarrationError(
				503,
				'NARRATION_PLAN_SAVE_FAILED',
				'Não foi possível salvar o plano.',
			);
		return version;
	}
	if (existing.current_version !== input.expectedVersion)
		throw new NarrationError(409, 'NARRATION_PLAN_CONFLICT', 'O plano foi alterado. Recarregue.');
	const version = existing.current_version + 1;
	const versions = [
		...(Array.isArray(existing.versions) ? existing.versions : []),
		{ version, createdAt: new Date().toISOString(), note: input.changeNote ?? '', hash, plan },
	].slice(-100);
	const { data: updated, error } = await input.adminDb
		.from('voice_direction_plans')
		.update({
			plan,
			current_version: version,
			current_status: input.status ?? 'DRAFT',
			versions,
		})
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('current_version', input.expectedVersion)
		.select('current_version')
		.maybeSingle();
	if (error || !updated)
		throw new NarrationError(409, 'NARRATION_PLAN_CONFLICT', 'O plano foi alterado. Recarregue.');
	return version;
}

export async function restoreVoicePlan(input: {
	adminDb: SupabaseClient | null;
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	version: number;
	expectedVersion: number;
}): Promise<number> {
	const { data, error } = await input.db
		.from('voice_direction_plans')
		.select('current_version,versions')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.maybeSingle();
	if (error || !data)
		throw new NarrationError(404, 'NARRATION_PLAN_NOT_FOUND', 'Plano de voz não encontrado.');
	if (data.current_version !== input.expectedVersion)
		throw new NarrationError(409, 'NARRATION_PLAN_CONFLICT', 'O plano foi alterado. Recarregue.');
	const versions = Array.isArray(data.versions)
		? (data.versions as StoredVoicePlan['versions'])
		: [];
	const snapshot = versions.find((entry) => entry.version === input.version)?.plan;
	const parsed = voiceDirectionPlanSchema.safeParse(snapshot);
	if (!parsed.success)
		throw new NarrationError(
			409,
			'NARRATION_VERSION_UNAVAILABLE',
			'Esta versão não tem um snapshot restaurável.',
		);
	return saveVoicePlan({
		adminDb: input.adminDb,
		db: input.db,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: input.expectedVersion,
		plan: parsed.data,
		changeNote: `Restauração da versão ${input.version}`,
		status: 'DRAFT',
	});
}

async function probeAudio(path: string): Promise<{
	durationMs: number;
	format: string;
	sampleRate: number;
	channels: number;
}> {
	let stdout: string;
	try {
		({ stdout } = await execFileAsync(
			'ffprobe',
			['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
			{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: mediaProcessEnv() },
		));
	} catch {
		throw new NarrationError(422, 'NARRATION_AUDIO_INVALID', 'O áudio não pôde ser lido.');
	}
	let parsed: {
		format?: { format_name?: string; duration?: string };
		streams?: Array<{ codec_type?: string; sample_rate?: string; channels?: number }>;
	};
	try {
		parsed = JSON.parse(stdout) as {
			format?: { format_name?: string; duration?: string };
			streams?: Array<{ codec_type?: string; sample_rate?: string; channels?: number }>;
		};
	} catch {
		throw new NarrationError(422, 'NARRATION_AUDIO_INVALID', 'O áudio não pôde ser lido.');
	}
	const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
	const durationSeconds = Number(parsed.format?.duration);
	if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
		throw new NarrationError(422, 'NARRATION_AUDIO_INVALID', 'O áudio não pôde ser lido.');
	return {
		durationMs: Math.round(durationSeconds * 1000),
		format: parsed.format?.format_name ?? 'unknown',
		sampleRate: Number(audio.sample_rate ?? 0),
		channels: audio.channels ?? 0,
	};
}

async function measureLoudness(path: string): Promise<{
	peakDb: number | null;
	rmsDb: number | null;
	truePeakDb: number | null;
	lufs: number | null;
}> {
	const { stderr } = await execFileAsync(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostdin',
			'-i',
			path,
			'-af',
			'volumedetect,ebur128=peak=true',
			'-f',
			'null',
			'-',
		],
		{ timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: mediaProcessEnv() },
	).catch((cause: { stderr?: string }) => ({ stderr: cause.stderr ?? '' }));
	const output = stderr ?? '';
	const peak = /max_volume:\s*(-?[0-9.]+) dB/.exec(output);
	const rms = /mean_volume:\s*(-?[0-9.]+) dB/.exec(output);
	const truePeaks = [...output.matchAll(/True peak:\s*Peak:\s*(-?[0-9.]+) dBFS/g)];
	const lufsValues = [...output.matchAll(/\bI:\s*(-?[0-9.]+) LUFS/g)];
	const truePeak = truePeaks.at(-1);
	const lufs = lufsValues.at(-1);
	return {
		peakDb: peak ? Number(peak[1]) : null,
		rmsDb: rms ? Number(rms[1]) : null,
		truePeakDb: truePeak ? Number(truePeak[1]) : null,
		lufs: lufs ? Number(lufs[1]) : null,
	};
}

export async function storeNarrationTake(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	storage: VideoStorage;
	episodeId: string;
	planVersion: number;
	bytes: Buffer;
	fileName: string;
	source: 'UPLOAD' | 'TTS';
	modelId?: string | null;
	modelLicense?: string | null;
	modelSha256?: string | null;
}): Promise<NarrationTake> {
	if (!input.adminDb)
		throw new NarrationError(
			503,
			'NARRATION_WRITER_UNAVAILABLE',
			'O writer de narração não está configurado.',
		);
	if (input.bytes.length < 1 || input.bytes.length > 20 * 1024 * 1024)
		throw new NarrationError(413, 'NARRATION_TOO_LARGE', 'O áudio excede o limite de 20 MB.');
	if (!/\.(wav|mp3|m4a)$/i.test(input.fileName))
		throw new NarrationError(415, 'NARRATION_FORMAT_INVALID', 'Envie WAV, MP3 ou M4A.');
	const directory = await mkdtemp(join(tmpdir(), 'dif-narration-'));
	const localPath = join(directory, input.fileName.replace(/[^A-Za-z0-9._-]/g, '_'));
	try {
		await writeFile(localPath, input.bytes);
		const probed = await probeAudio(localPath);
		if (probed.durationMs < 1_000 || probed.durationMs > 600_000)
			throw new NarrationError(422, 'NARRATION_DURATION_INVALID', 'Duração do áudio inválida.');
		if (probed.channels < 1 || probed.channels > 2 || probed.sampleRate < 8_000)
			throw new NarrationError(422, 'NARRATION_AUDIO_INVALID', 'Formato de áudio inválido.');
		const extension = input.fileName.split('.').at(-1)?.toLowerCase() ?? 'wav';
		const expectedFormats =
			extension === 'mp3' ? ['mp3'] : extension === 'm4a' ? ['mp4', 'm4a', 'mov'] : ['wav'];
		if (!expectedFormats.some((format) => probed.format.toLowerCase().includes(format)))
			throw new NarrationError(
				415,
				'NARRATION_FORMAT_MISMATCH',
				'A extensão não corresponde ao formato real do áudio.',
			);
		const loudness = await measureLoudness(localPath);
		if (
			(loudness.truePeakDb !== null && loudness.truePeakDb > -0.5) ||
			(loudness.peakDb !== null && loudness.peakDb > -0.5)
		)
			throw new NarrationError(422, 'NARRATION_CLIPPING', 'O áudio está com clipping.');
		if (loudness.peakDb !== null && loudness.peakDb < -60)
			throw new NarrationError(422, 'NARRATION_SILENT', 'O áudio não tem voz audível.');
		const takeId = crypto.randomUUID();
		const audioContentType =
			extension === 'mp3' ? 'audio/mpeg' : extension === 'm4a' ? 'audio/mp4' : 'audio/wav';
		const key = `narration/${input.owner.id}/${input.episodeId}/${takeId}.${extension}`;
		const stored = await input.storage.putObject({
			key,
			body: input.bytes,
			contentType: audioContentType,
		});
		const sha256 = createHash('sha256').update(input.bytes).digest('hex');
		const { data, error } = await input.adminDb
			.from('narration_takes')
			.insert({
				id: takeId,
				owner_id: input.owner.id,
				episode_id: input.episodeId,
				plan_version: input.planVersion,
				source: input.source,
				status: 'READY',
				bucket: stored.bucket,
				object_key: stored.key,
				sha256,
				byte_size: stored.size,
				duration_ms: probed.durationMs,
				format: probed.format,
				sample_rate: probed.sampleRate,
				channels: probed.channels,
				peak_db: loudness.peakDb,
				rms_db: loudness.rmsDb,
				true_peak_db: loudness.truePeakDb,
				lufs: loudness.lufs,
				model_id: input.modelId ?? null,
				model_license: input.modelLicense ?? null,
				model_sha256: input.modelSha256 ?? null,
			})
			.select(
				'id,episode_id,plan_version,source,status,sha256,byte_size,duration_ms,format,sample_rate,channels,peak_db,rms_db,true_peak_db,lufs,model_id,model_license,model_sha256,created_at',
			)
			.single();
		if (error || !data) {
			await input.storage.deleteObject(key).catch(() => undefined);
			throw new NarrationError(503, 'NARRATION_SAVE_FAILED', 'Não foi possível registrar a voz.');
		}
		return data as NarrationTake;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function listNarrationTakes(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<NarrationTake[]> {
	const { data, error } = await db
		.from('narration_takes')
		.select(
			'id,episode_id,plan_version,source,status,sha256,byte_size,duration_ms,format,sample_rate,channels,peak_db,rms_db,true_peak_db,lufs,model_id,model_license,model_sha256,created_at',
		)
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.order('created_at', { ascending: false })
		.limit(30);
	if (error)
		throw new NarrationError(503, 'NARRATION_LIST_FAILED', 'Não foi possível listar as vozes.');
	return (data ?? []) as NarrationTake[];
}

export async function getNarrationTakeDownload(input: {
	db: SupabaseClient;
	owner: User;
	storage: VideoStorage;
	takeId: string;
}): Promise<{ url: string; contentType: string }> {
	const { data, error } = await input.db
		.from('narration_takes')
		.select('id,object_key,status,format')
		.eq('owner_id', input.owner.id)
		.eq('id', input.takeId)
		.maybeSingle();
	if (error || !data || data.status !== 'READY')
		throw new NarrationError(404, 'NARRATION_TAKE_NOT_FOUND', 'Voz não encontrada.');
	return {
		url: await input.storage.signDownload(data.object_key as string, 60),
		contentType: 'audio/*',
	};
}
