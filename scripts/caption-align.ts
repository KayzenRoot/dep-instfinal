/**
 * WO-008 offline caption alignment CLI. Requires a real narration take and
 * either an ASR word JSON or a local Vosk model. Without either, the editor's
 * manual fallback remains available.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient, type User } from '@supabase/supabase-js';
import {
	buildCaptionAss,
	buildCaptionSrt,
	buildCaptionTrack,
	type AsrWordInput,
} from '../src/lib/domain/captions.js';
import {
	CaptionServiceError,
	loadCaptionContext,
	saveCaptionTrack,
} from '../src/lib/server/captions.js';
import {
	captionTrackSchema,
	type CaptionStyle,
	type CaptionTrack,
} from '../src/lib/schemas/captions.js';

const execFileAsync = promisify(execFile);

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`missing_${name.toLowerCase()}`);
	return value;
}

function parseAsrWords(raw: unknown): AsrWordInput[] {
	const object = raw as {
		words?: Array<{ word?: string; startMs?: number; endMs?: number; confidence?: number }>;
		result?: Array<{ word?: string; start?: number; end?: number; conf?: number }>;
	};
	const entries = object.words ?? object.result ?? [];
	return entries
		.map((entry) => {
			const word = String(entry.word ?? '').trim();
			const startMs =
				'startMs' in entry && entry.startMs !== undefined
					? Number(entry.startMs)
					: Number(entry.start) * 1000;
			const endMs =
				'endMs' in entry && entry.endMs !== undefined
					? Number(entry.endMs)
					: Number(entry.end) * 1000;
			const confidence = 'confidence' in entry ? entry.confidence : entry.conf;
			if (!word || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
			return {
				word,
				startMs: Math.max(0, Math.round(startMs)),
				endMs: Math.max(0, Math.round(endMs)),
				confidence: typeof confidence === 'number' ? confidence : null,
			};
		})
		.filter((entry): entry is AsrWordInput => entry !== null);
}

async function resolveAsrWords(): Promise<AsrWordInput[]> {
	const asrFile = process.env.CAPTION_ASR_FILE?.trim();
	if (asrFile) return parseAsrWords(JSON.parse(await readFile(asrFile, 'utf8')));
	const audioFile = process.env.CAPTION_AUDIO_FILE?.trim();
	const model = process.env.VOSK_MODEL?.trim();
	const python = process.env.VOSK_PYTHON?.trim() || 'python';
	if (!audioFile || !model)
		throw new Error(
			'missing_caption_asr_source: set CAPTION_ASR_FILE or CAPTION_AUDIO_FILE + VOSK_MODEL',
		);
	const output = resolve(process.env.CAPTION_OUTPUT_DIR ?? '.', 'asr-words.json');
	await execFileAsync(
		python,
		[resolve('scripts/asr-vosk.py'), '--input', audioFile, '--output', output, '--model', model],
		{ timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
	);
	return parseAsrWords(JSON.parse(await readFile(output, 'utf8')));
}

async function main() {
	const episodeId = required('CAPTION_EPISODE_ID');
	const url = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('missing_supabase_config');
	const admin = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});
	const { data: episode, error } = await admin
		.from('episodes')
		.select('owner_id')
		.eq('id', episodeId)
		.maybeSingle();
	if (error || !episode) throw new Error('caption_episode_not_found');
	const owner = { id: episode.owner_id } as User;
	const requestedVersion = process.env.CAPTION_PLAN_VERSION
		? Number(process.env.CAPTION_PLAN_VERSION)
		: null;
	const context = await loadCaptionContext(admin, owner, episodeId, requestedVersion);
	if (!context.narrationTakeId)
		throw new Error('caption_narration_take_required: aprove uma voz antes de alinhar legendas');
	const words = await resolveAsrWords();
	const style = (process.env.CAPTION_STYLE ?? 'clean') as CaptionStyle;
	const safeZone = (process.env.CAPTION_SAFE_ZONE ?? 'tiktok') as CaptionTrack['safeZone'];
	const track = buildCaptionTrack({
		episodeId: context.episodeId,
		planId: context.planId,
		planVersion: context.planVersion,
		narrationTakeId: context.narrationTakeId,
		durationMs: context.durationMs,
		segments: context.segments,
		asrWords: words,
		style,
		safeZone,
		audioSha256: context.audioSha256,
	});
	const outputDir = resolve(required('CAPTION_OUTPUT_DIR'));
	await mkdir(outputDir, { recursive: true });
	const srt = buildCaptionSrt(track.cues);
	const ass = buildCaptionAss(track);
	const validated = captionTrackSchema.parse(track);
	await writeFile(
		join(outputDir, 'captions.json'),
		`${JSON.stringify(validated, null, 2)}\n`,
		'utf8',
	);
	await writeFile(join(outputDir, 'captions.srt'), srt, 'utf8');
	await writeFile(join(outputDir, 'captions.ass'), ass, 'utf8');
	let version: number | null = null;
	if (process.env.CAPTION_UPLOAD === '1') {
		version = await saveCaptionTrack({
			adminDb: admin,
			db: admin,
			owner,
			episodeId,
			planVersion: context.planVersion,
			expectedVersion: Number(process.env.CAPTION_EXPECTED_VERSION ?? 0),
			track: validated,
			changeNote: process.env.CAPTION_CHANGE_NOTE?.trim() || 'Alinhamento ASR local',
			status: process.env.CAPTION_STATUS === 'APPROVED' ? 'APPROVED' : 'DRAFT',
		});
	}
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		episodeId,
		planId: context.planId,
		planVersion: context.planVersion,
		narrationTakeId: context.narrationTakeId,
		style,
		safeZone,
		source: track.source,
		alignmentScore: track.alignmentScore,
		scriptSha256: track.scriptSha256,
		audioSha256: track.audioSha256,
		cues: track.cues.length,
		srtSha256: createHash('sha256').update(srt).digest('hex'),
		assSha256: createHash('sha256').update(ass).digest('hex'),
		uploadedVersion: version,
	};
	await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((cause) => {
	if (cause instanceof CaptionServiceError)
		process.stderr.write(`${cause.code}:${cause.message}\n`);
	else process.stderr.write(`${cause instanceof Error ? cause.message : 'caption_failed'}\n`);
	process.exitCode = 1;
});
