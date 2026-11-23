#!/usr/bin/env node
// Validates quarantined video assets and pending narration takes outside the
// Vercel runtime (where ffprobe/ffmpeg are unavailable). The web tier stores
// uploads as QUARANTINED/PENDING; this worker claims them with the service role,
// probes the bytes, and publishes READY or REJECTED.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { measureAudioLoudness } from '../src/lib/server/audio-analysis.js';
import { probeAudioMedia } from '../src/lib/server/render-compose.js';
import {
	FfprobeVideoProbe,
	validateProbe,
	type ProbeResult,
} from '../src/lib/server/video-probe.js';

interface VideoAssetRow {
	id: string;
	owner_id: string;
	episode_id: string;
	scene_id: string;
	asset_version: number;
	bucket: string;
	object_key: string;
	validation_attempts: number;
}

interface NarrationTakeRow {
	id: string;
	owner_id: string;
	episode_id: string;
	bucket: string;
	object_key: string;
	validation_attempts: number;
}

class MediaValidationError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = 'MediaValidationError';
	}
}

const url = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
	console.error(
		JSON.stringify({ event: 'worker_config_error', message: 'Supabase worker URL/key missing' }),
	);
	process.exit(1);
}
const bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
	console.error(
		JSON.stringify({ event: 'worker_config_error', message: 'R2 worker config missing' }),
	);
	process.exit(1);
}

const workerId = (
	process.env.WORKER_ID ?? `media-${process.env.COMPUTERNAME ?? 'worker'}-${process.pid}`
).slice(0, 80);
const pollMs = Math.max(
	250,
	Math.min(30_000, Number(process.env.WORKER_POLL_MS ?? 1_000) || 1_000),
);
const maxJobs = Math.max(0, Math.min(10_000, Number(process.env.WORKER_MAX_JOBS ?? 0) || 0));
const staleSeconds = Math.max(
	60,
	Math.min(3_600, Number(process.env.WORKER_VALIDATION_STALE_SECONDS ?? 600) || 600),
);
const maxAttempts = Math.max(
	1,
	Math.min(10, Number(process.env.WORKER_VALIDATION_ATTEMPTS ?? 3) || 3),
);
const retentionDays = Math.max(
	1,
	Math.min(365, Number(process.env.VIDEO_RETENTION_DAYS ?? 30) || 30),
);
const ffprobePath = process.env.FFPROBE_PATH?.trim() || 'ffprobe';

const supabase = createClient(url, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const s3 = new S3Client({
	region: 'auto',
	endpoint,
	forcePathStyle: true,
	credentials: { accessKeyId, secretAccessKey },
});
const videoProbe = new FfprobeVideoProbe(ffprobePath);

let stopping = false;
let jobsRun = 0;

function log(event: string, fields: Record<string, unknown> = {}) {
	console.log(JSON.stringify({ event, workerId, ...fields }));
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function asAttempts(row: { validation_attempts?: number }): number {
	const value = Number(row.validation_attempts ?? 1);
	return Number.isFinite(value) ? value : 1;
}

async function downloadObject(key: string, destination: string) {
	const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!object.Body) throw new MediaValidationError('EMPTY_OBJECT');
	await writeFile(destination, Buffer.from(await object.Body.transformToByteArray()));
}

async function claimVideo(): Promise<VideoAssetRow | null> {
	const { data, error } = await supabase.rpc('claim_video_asset_for_validation', {
		p_stale_seconds: staleSeconds,
	});
	if (error) {
		log('claim_video_error', { code: error.code });
		return null;
	}
	const row = Array.isArray(data) ? data[0] : data;
	return (row as VideoAssetRow | undefined) ?? null;
}

async function claimNarration(): Promise<NarrationTakeRow | null> {
	const { data, error } = await supabase.rpc('claim_narration_take_for_validation', {
		p_stale_seconds: staleSeconds,
	});
	if (error) {
		log('claim_narration_error', { code: error.code });
		return null;
	}
	const row = Array.isArray(data) ? data[0] : data;
	return (row as NarrationTakeRow | undefined) ?? null;
}

async function rejectVideo(asset: VideoAssetRow, code: string) {
	await supabase
		.from('video_assets')
		.update({ status: 'REJECTED', safe_error_code: code, updated_at: new Date().toISOString() })
		.eq('id', asset.id)
		.eq('status', 'VALIDATING');
	await s3
		.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.object_key }))
		.catch(() => undefined);
	log('video_rejected', { assetId: asset.id, code });
}

async function retryVideo(asset: VideoAssetRow, code: string) {
	if (asAttempts(asset) >= maxAttempts) {
		await rejectVideo(asset, code);
		return;
	}
	await supabase
		.from('video_assets')
		.update({
			status: 'QUARANTINED',
			safe_error_code: `VALIDATOR_RETRY_${code}`.slice(0, 64),
			updated_at: new Date().toISOString(),
		})
		.eq('id', asset.id)
		.eq('status', 'VALIDATING');
	log('video_retry', { assetId: asset.id, attempts: asAttempts(asset), code });
}

async function publishVideo(asset: VideoAssetRow, result: ProbeResult) {
	const finalKey = `owners/${asset.owner_id}/episodes/${asset.episode_id}/scenes/${asset.scene_id}/v${asset.asset_version}/${asset.id}.mp4`;
	await s3.send(
		new CopyObjectCommand({
			Bucket: bucket,
			CopySource: `${bucket}/${asset.object_key}`,
			Key: finalKey,
		}),
	);
	const validatedAt = new Date();
	const { error } = await supabase
		.from('video_assets')
		.update({
			status: 'READY',
			object_key: finalKey,
			duration_ms: result.durationMs,
			width: result.width,
			height: result.height,
			codec: result.codec,
			container: result.container,
			validated_at: validatedAt.toISOString(),
			retention_until: new Date(validatedAt.getTime() + retentionDays * 86_400_000).toISOString(),
			safe_error_code: null,
		})
		.eq('id', asset.id)
		.eq('status', 'VALIDATING');
	if (error) throw new MediaValidationError(`UPDATE_${error.code ?? 'FAILED'}`);
	await s3
		.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.object_key }))
		.catch(() => undefined);
	log('video_ready', {
		assetId: asset.id,
		sceneId: asset.scene_id,
		durationMs: result.durationMs,
		width: result.width,
		height: result.height,
	});
}

async function processVideo(asset: VideoAssetRow) {
	const directory = await mkdtemp(join(tmpdir(), 'dif-validate-video-'));
	const localPath = join(directory, 'source.mp4');
	try {
		const { data: episode, error } = await supabase
			.from('episodes')
			.select('scene_duration_ms')
			.eq('id', asset.episode_id)
			.eq('owner_id', asset.owner_id)
			.maybeSingle();
		if (error || !episode) throw new MediaValidationError('EPISODE_MISSING');
		await downloadObject(asset.object_key, localPath);
		const probed = await videoProbe.probeFile(localPath);
		const validation = validateProbe(probed, Number(episode.scene_duration_ms ?? 8_000));
		if (!validation.ok) {
			await rejectVideo(asset, validation.code);
			return;
		}
		await publishVideo(asset, validation.result);
	} catch (cause) {
		const code =
			cause instanceof MediaValidationError && /^[A-Z0-9_]{1,64}$/.test(cause.code)
				? cause.code
				: 'VALIDATOR_ERROR';
		await retryVideo(asset, code);
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function rejectNarration(take: NarrationTakeRow, code: string) {
	await supabase
		.from('narration_takes')
		.update({ status: 'REJECTED', safe_error_code: code, updated_at: new Date().toISOString() })
		.eq('id', take.id)
		.eq('status', 'VALIDATING');
	log('narration_rejected', { takeId: take.id, code });
}

async function retryNarration(take: NarrationTakeRow, code: string) {
	if (asAttempts(take) >= maxAttempts) {
		await rejectNarration(take, code);
		return;
	}
	await supabase
		.from('narration_takes')
		.update({
			status: 'PENDING',
			safe_error_code: `VALIDATOR_RETRY_${code}`.slice(0, 64),
			updated_at: new Date().toISOString(),
		})
		.eq('id', take.id)
		.eq('status', 'VALIDATING');
	log('narration_retry', { takeId: take.id, attempts: asAttempts(take), code });
}

async function processNarration(take: NarrationTakeRow) {
	const directory = await mkdtemp(join(tmpdir(), 'dif-validate-narration-'));
	const extension = take.object_key.split('.').at(-1)?.toLowerCase() ?? 'wav';
	const localPath = join(directory, `source.${extension}`);
	try {
		await downloadObject(take.object_key, localPath);
		const probed = await probeAudioMedia(localPath, ffprobePath);
		if (probed.durationMs < 1_000 || probed.durationMs > 600_000)
			throw new MediaValidationError('NARRATION_DURATION_INVALID');
		if (probed.channels < 1 || probed.channels > 2 || probed.sampleRate < 8_000)
			throw new MediaValidationError('NARRATION_AUDIO_INVALID');
		const expectedFormats =
			extension === 'mp3' ? ['mp3'] : extension === 'm4a' ? ['mp4', 'm4a', 'mov'] : ['wav'];
		if (!expectedFormats.some((format) => probed.format.toLowerCase().includes(format)))
			throw new MediaValidationError('NARRATION_FORMAT_MISMATCH');
		const loudness = await measureAudioLoudness(localPath);
		if (loudness.peakDb === null && loudness.truePeakDb === null)
			throw new MediaValidationError('NARRATION_LOUDNESS_FAILED');
		if (
			(loudness.truePeakDb !== null && loudness.truePeakDb > -0.5) ||
			(loudness.peakDb !== null && loudness.peakDb > -0.5)
		)
			throw new MediaValidationError('NARRATION_CLIPPING');
		if (loudness.peakDb !== null && loudness.peakDb < -60)
			throw new MediaValidationError('NARRATION_SILENT');
		const { error } = await supabase
			.from('narration_takes')
			.update({
				status: 'READY',
				duration_ms: probed.durationMs,
				format: probed.format,
				sample_rate: probed.sampleRate,
				channels: probed.channels,
				peak_db: loudness.peakDb,
				rms_db: loudness.rmsDb,
				true_peak_db: loudness.truePeakDb,
				lufs: loudness.lufs,
				validated_at: new Date().toISOString(),
				safe_error_code: null,
			})
			.eq('id', take.id)
			.eq('status', 'VALIDATING');
		if (error) throw new MediaValidationError(`UPDATE_${error.code ?? 'FAILED'}`);
		log('narration_ready', { takeId: take.id, durationMs: probed.durationMs });
	} catch (cause) {
		const code =
			cause instanceof MediaValidationError && /^[A-Z0-9_]{1,64}$/.test(cause.code)
				? cause.code
				: 'VALIDATOR_ERROR';
		await retryNarration(take, code);
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function main() {
	log('worker_started', {
		pollMs,
		maxJobs,
		staleSeconds,
		maxAttempts,
		ffprobePath,
	});
	while (!stopping) {
		const asset = await claimVideo();
		if (asset) {
			await processVideo(asset);
			jobsRun += 1;
		} else {
			const take = await claimNarration();
			if (take) {
				await processNarration(take);
				jobsRun += 1;
			} else {
				await sleep(pollMs);
			}
		}
		if (maxJobs > 0 && jobsRun >= maxJobs) break;
	}
	log('worker_stopped', { jobsRun });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		stopping = true;
		log('worker_stopping', { signal });
	});
}

main().catch((cause: unknown) => {
	console.error(
		JSON.stringify({ event: 'worker_fatal', workerId, message: String(cause).slice(0, 300) }),
	);
	process.exitCode = 1;
});
