import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createClient, type User } from '@supabase/supabase-js';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { videoEditPlanSchema } from '../src/lib/schemas/video-edit-plan.js';
import {
	loadEditPlanContext,
	manifestHash,
	validateForContext,
} from '../src/lib/server/video-edit-plans.js';
import { probeAudioMedia, probeMedia, renderPlanToFile } from '../src/lib/server/render-compose.js';
import { inspectRenderArtifact } from '../src/lib/server/quality-inspector.js';
import { recordQualityReport } from '../src/lib/server/quality-reports.js';
import type { AudioMixEvent } from '../src/lib/domain/render-composition.js';
import { buildCaptionAss } from '../src/lib/domain/captions.js';
import { buildEndCardAss, buildEndCardSfxWav } from '../src/lib/domain/choice-end-card.js';
import { layoutFromPlan, resolvePreviewLayout } from '../src/lib/domain/platform-preview.js';
import { captionTrackSchema, type CaptionTrack } from '../src/lib/schemas/captions.js';

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`missing_${name.toLowerCase()}`);
	return value;
}

function safeCode(cause: unknown): string {
	if (
		cause &&
		typeof cause === 'object' &&
		typeof (cause as { code?: unknown }).code === 'string'
	) {
		const code = (cause as { code: string }).code;
		if (/^[A-Z0-9_]{1,64}$/.test(code)) return code;
	}
	if (cause instanceof Error) {
		const match = /^[A-Z0-9_]{1,64}$/.exec(cause.message);
		if (match) return match[0];
	}
	return 'RENDER_FAILED';
}

async function main() {
	const jobId = required('RENDER_JOB_ID');
	const url =
		process.env.WORKER_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.WORKER_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('missing_supabase');
	const admin = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});
	const { data: job, error: jobError } = await admin
		.from('render_jobs')
		.select('*')
		.eq('id', jobId)
		.maybeSingle();
	if (jobError || !job) throw new Error('render_job_not_found');
	if (!['CLAIMED', 'RUNNING'].includes(job.status)) throw new Error('render_job_not_running');

	const { data: version, error: versionError } = await admin
		.from('video_edit_plan_versions')
		.select('plan,manifest_hash')
		.eq('owner_id', job.owner_id)
		.eq('plan_id', job.plan_id)
		.eq('version', job.plan_version)
		.maybeSingle();
	if (versionError || !version) throw new Error('render_plan_version_not_found');
	const plan = videoEditPlanSchema.parse(version.plan);
	const owner = { id: job.owner_id } as User;
	const context = await loadEditPlanContext(admin, owner, job.episode_id);
	const validated = validateForContext(plan, context);
	if (manifestHash(validated) !== version.manifest_hash)
		throw new Error('render_plan_hash_mismatch');
	const captionLayout = layoutFromPlan(validated);
	const captionLayoutHash = captionLayout
		? createHash('sha256').update(JSON.stringify(captionLayout)).digest('hex')
		: null;
	const outputProfile = job.output_profile === '720p' ? '720p' : '1080p';
	const quality = job.quality === 'high' ? 'high' : 'standard';
	const outputWidth = outputProfile === '720p' ? 720 : 1080;
	const outputHeight = outputProfile === '720p' ? 1280 : 1920;
	const ffmpegThreads = Math.max(1, Math.min(8, Number(process.env.WORKER_FFMPEG_THREADS ?? 2)));
	const assets = [];
	for (const clip of validated.clips) {
		const { data: asset, error: assetError } = await admin
			.from('video_assets')
			.select('id,object_key,bucket,sha256,byte_size,duration_ms,width,height,status')
			.eq('owner_id', job.owner_id)
			.eq('id', clip.assetId)
			.maybeSingle();
		if (assetError || !asset || asset.status !== 'READY' || !asset.object_key)
			throw new Error('render_asset_not_ready');
		assets.push(asset);
	}
	let caption: { id: string; track: CaptionTrack } | null = null;
	if (validated.captions.template !== 'none') {
		let captionQuery = admin
			.from('caption_tracks')
			.select('id,track,current_status')
			.eq('owner_id', job.owner_id)
			.eq('episode_id', job.episode_id)
			.eq('plan_version', job.plan_version)
			.eq('current_status', 'APPROVED');
		captionQuery = job.narration_take_id
			? captionQuery.eq('narration_take_id', job.narration_take_id)
			: captionQuery.is('narration_take_id', null);
		const { data: captionRow, error: captionError } = await captionQuery.maybeSingle();
		if (captionError) throw new Error('caption_track_invalid');
		if (captionRow) {
			const parsedCaption = captionTrackSchema.safeParse(captionRow.track);
			if (!parsedCaption.success) throw new Error('caption_track_invalid');
			if (parsedCaption.data.narrationTakeId !== job.narration_take_id)
				throw new Error('caption_take_mismatch');
			caption = { id: captionRow.id, track: parsedCaption.data };
		}
		if (!caption) throw new Error('captions_not_approved');
	}
	let narration: {
		id: string;
		object_key: string;
		bucket: string;
		sha256: string;
		byte_size: number;
		duration_ms: number;
	} | null = null;
	if (job.narration_take_id) {
		const { data: take, error: takeError } = await admin
			.from('narration_takes')
			.select('id,episode_id,object_key,bucket,sha256,byte_size,duration_ms,status')
			.eq('owner_id', job.owner_id)
			.eq('id', job.narration_take_id)
			.maybeSingle();
		if (
			takeError ||
			!take ||
			take.status !== 'READY' ||
			take.episode_id !== job.episode_id ||
			!take.object_key
		)
			throw new Error('narration_take_not_ready');
		narration = {
			id: take.id,
			object_key: take.object_key,
			bucket: take.bucket,
			sha256: take.sha256,
			byte_size: Number(take.byte_size),
			duration_ms: take.duration_ms,
		};
	}
	const planAudioEvents = validated.audio?.events ?? [];
	const audioAssets = new Map<
		string,
		{
			id: string;
			kind: string;
			bucket: string;
			object_key: string;
			sha256: string;
			byte_size: number;
			duration_ms: number;
			intensity: number;
			license_name: string;
			attribution: string;
			license_status: string;
			commercial_allowed: boolean;
			social_allowed: boolean;
		}
	>();
	if (planAudioEvents.length) {
		const { data: audioRows, error: audioError } = await admin
			.from('audio_assets')
			.select(
				'id,kind,bucket,object_key,sha256,byte_size,duration_ms,intensity,license_status,commercial_allowed,social_allowed,license_name,attribution',
			)
			.eq('owner_id', job.owner_id)
			.in('id', [...new Set(planAudioEvents.map((event) => event.assetId))]);
		if (audioError) throw new Error('AUDIO_ASSET_LOAD_FAILED');
		for (const row of audioRows ?? []) audioAssets.set(row.id as string, row);
		for (const event of planAudioEvents) {
			const asset = audioAssets.get(event.assetId);
			if (!asset || !asset.object_key) throw new Error('AUDIO_ASSET_NOT_READY');
			if (asset.license_status !== 'VERIFIED' || !asset.commercial_allowed || !asset.social_allowed)
				throw new Error('AUDIO_LICENSE_BLOCKED');
			if (asset.kind !== event.kind) throw new Error('AUDIO_KIND_MISMATCH');
			if (event.sourceInMs >= Number(asset.duration_ms))
				throw new Error('AUDIO_SOURCE_OUT_OF_RANGE');
			if (!event.loop && event.sourceInMs + event.durationMs > Number(asset.duration_ms))
				throw new Error('AUDIO_SOURCE_OUT_OF_RANGE');
		}
	}
	const providedWork = process.env.WORKER_RENDER_TMPDIR;
	const work = providedWork ?? (await mkdtemp(join(tmpdir(), `dif-render-${jobId.slice(0, 8)}-`)));
	const ownsWork = !providedWork;
	try {
		const localDir = process.env.WORKER_ASSET_DIR;
		const localNarrationDir = process.env.WORKER_NARRATION_DIR;
		const localAudioDir = process.env.WORKER_AUDIO_DIR;
		const localPaths = new Map<string, string>();
		let r2: S3Client | null = null;
		const bucket = process.env.R2_BUCKET;
		if (
			!localDir ||
			(narration && !localNarrationDir) ||
			(planAudioEvents.length > 0 && !localAudioDir)
		) {
			if (!bucket) throw new Error('missing_r2_bucket');
			r2 = new S3Client({
				region: 'auto',
				endpoint: required('R2_ENDPOINT'),
				credentials: {
					accessKeyId: required('R2_ACCESS_KEY_ID'),
					secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
				},
			});
		}
		if (localDir) {
			for (const asset of assets) localPaths.set(asset.id, join(localDir, `${asset.id}.mp4`));
		} else {
			for (const asset of assets) {
				const destination = join(work, `${asset.id}.mp4`);
				const object = await r2!.send(
					new GetObjectCommand({ Bucket: bucket, Key: asset.object_key }),
				);
				if (!object.Body) throw new Error('render_asset_download_failed');
				await pipeline(
					object.Body as NodeJS.ReadableStream,
					await import('node:fs').then((fs) => fs.createWriteStream(destination)),
				);
				localPaths.set(asset.id, destination);
			}
		}
		const inputs = [];
		for (const asset of assets) {
			const path = localPaths.get(asset.id);
			if (!path) throw new Error('render_asset_missing');
			const bytes = await readFile(path);
			const digest = createHash('sha256').update(bytes).digest('hex');
			if (asset.sha256 && asset.sha256 !== digest) throw new Error('render_asset_hash_mismatch');
			if (asset.byte_size && Number(asset.byte_size) !== bytes.length)
				throw new Error('render_asset_size_mismatch');
			const probe = await probeMedia(path);
			inputs.push({
				assetId: asset.id,
				path,
				durationMs: probe.durationMs,
				width: probe.width,
				height: probe.height,
			});
		}
		let narrationInput;
		if (narration) {
			const narrationPath = localNarrationDir
				? join(localNarrationDir, `${narration.id}.wav`)
				: join(work, `narration-${narration.id}.wav`);
			if (!localNarrationDir) {
				const object = await r2!.send(
					new GetObjectCommand({ Bucket: bucket, Key: narration.object_key }),
				);
				if (!object.Body) throw new Error('narration_download_failed');
				await pipeline(
					object.Body as NodeJS.ReadableStream,
					await import('node:fs').then((fs) => fs.createWriteStream(narrationPath)),
				);
			}
			const audioBytes = await readFile(narrationPath);
			const audioDigest = createHash('sha256').update(audioBytes).digest('hex');
			if (narration.sha256 !== audioDigest) throw new Error('narration_hash_mismatch');
			if (narration.byte_size !== audioBytes.length) throw new Error('narration_size_mismatch');
			const audioProbe = await probeAudioMedia(narrationPath);
			if (Math.abs(audioProbe.durationMs - narration.duration_ms) > 500)
				throw new Error('narration_duration_mismatch');
			narrationInput = {
				path: narrationPath,
				durationMs: audioProbe.durationMs,
				takeId: narration.id,
			};
		}
		const audioInputs: AudioMixEvent[] = [];
		for (const event of planAudioEvents) {
			const asset = audioAssets.get(event.assetId)!;
			const extension = /\.([a-z0-9]+)$/i.exec(asset.object_key)?.[1]?.toLowerCase() ?? 'wav';
			let audioPath: string;
			if (localAudioDir) {
				const candidates = [extension, 'wav', 'mp3', 'm4a', 'ogg'].map((candidate) =>
					join(localAudioDir, `${event.assetId}.${candidate}`),
				);
				const found = candidates.find((candidate) => existsSync(candidate));
				if (!found) throw new Error('AUDIO_ASSET_MISSING');
				audioPath = found;
			} else {
				audioPath = join(work, `audio-${event.assetId}.${extension}`);
				const object = await r2!.send(
					new GetObjectCommand({ Bucket: bucket, Key: asset.object_key }),
				);
				if (!object.Body) throw new Error('AUDIO_ASSET_DOWNLOAD_FAILED');
				await pipeline(
					object.Body as NodeJS.ReadableStream,
					await import('node:fs').then((fs) => fs.createWriteStream(audioPath)),
				);
			}
			const audioBytes = await readFile(audioPath);
			const audioDigest = createHash('sha256').update(audioBytes).digest('hex');
			if (audioDigest !== asset.sha256) throw new Error('AUDIO_ASSET_HASH_MISMATCH');
			if (audioBytes.length !== Number(asset.byte_size))
				throw new Error('AUDIO_ASSET_SIZE_MISMATCH');
			const audioProbe = await probeAudioMedia(audioPath);
			if (!event.loop && event.sourceInMs + event.durationMs > audioProbe.durationMs + 500)
				throw new Error('AUDIO_SOURCE_OUT_OF_RANGE');
			audioInputs.push({
				id: event.id,
				path: audioPath,
				kind: event.kind,
				startMs: event.startMs,
				durationMs: event.durationMs,
				sourceInMs: event.sourceInMs,
				gainDb: event.gainDb,
				directorGainDb: event.directorGainDb,
				fadeInMs: event.fadeInMs,
				fadeOutMs: event.fadeOutMs,
				pan: event.pan,
				distance: event.distance,
				loop: event.loop,
				ducking: event.ducking,
				spatialPreset: event.spatialPreset,
				spatialMode: event.spatialMode,
				intensity: Number(asset.intensity),
			});
		}
		let captionAssPath: string | undefined;
		if (caption) {
			captionAssPath = join(work, 'captions.ass');
			await writeFile(
				captionAssPath,
				buildCaptionAss(caption.track, captionLayout ?? undefined),
				'utf8',
			);
		}
		let endCardAssPath: string | undefined;
		if (validated.endCard) {
			endCardAssPath = join(work, 'endcard.ass');
			await writeFile(
				endCardAssPath,
				buildEndCardAss(
					validated.endCard,
					resolvePreviewLayout(validated.preview).profile.safeArea,
				),
				'utf8',
			);
			const sfx = buildEndCardSfxWav(
				validated.endCard.sfx,
				validated.endCard.endMs - validated.endCard.startMs,
				validated.endCard.sfxVolumeDb,
			);
			if (sfx) {
				const sfxPath = join(work, 'endcard-sfx.wav');
				await writeFile(sfxPath, sfx);
				audioInputs.push({
					id: crypto.randomUUID(),
					path: sfxPath,
					kind: 'SFX',
					startMs: validated.endCard.startMs,
					durationMs: validated.endCard.endMs - validated.endCard.startMs,
					sourceInMs: 0,
					gainDb: 0,
					fadeInMs: 60,
					fadeOutMs: 120,
					pan: 0,
					distance: 0.5,
					loop: false,
					ducking: false,
					spatialPreset: 'none',
					spatialMode: 'stereo_pan',
					intensity: 1,
				});
			}
		}
		const outputPath = join(work, 'output.mp4');
		const configuredVhs = Number(process.env.WORKER_VHS_INTENSITY ?? 1);
		const vhsIntensity: 0 | 1 | 2 | 3 =
			configuredVhs === 0 || configuredVhs === 2 || configuredVhs === 3 ? configuredVhs : 1;
		const output = await renderPlanToFile({
			plan: validated,
			assets: inputs,
			outputPath,
			vhsIntensity,
			timeoutMs: 600_000,
			captionAssPath,
			endCardAssPath,
			narration: narrationInput,
			audioEvents: audioInputs,
			masterGainDb: validated.audio?.masterGainDb,
			width: outputWidth,
			height: outputHeight,
			quality,
			threads: ffmpegThreads,
		});
		const qualityResult = await inspectRenderArtifact({
			jobId: job.id,
			episodeId: job.episode_id,
			planId: job.plan_id,
			planVersion: job.plan_version,
			planSha256: version.manifest_hash,
			plan: validated,
			output,
			captionTrack: caption?.track ?? null,
			narrationExpected: Boolean(narrationInput),
			hasAudioExpected: Boolean(narrationInput || audioInputs.length),
			outputProfile,
			quality,
		});
		const qualityReport = await recordQualityReport({
			adminDb: admin,
			ownerId: job.owner_id,
			jobId: job.id,
			episodeId: job.episode_id,
			planId: job.plan_id,
			planVersion: job.plan_version,
			artifactSha256: output.sha256,
			reportSha256: qualityResult.reportSha256,
			report: qualityResult.report,
		});
		if (qualityResult.status === 'BLOCKED') {
			const blocked = qualityResult.report.checks.find((check) => check.status === 'BLOCKED');
			throw Object.assign(new Error(`QA_BLOCKED:${blocked?.id ?? 'UNKNOWN'}`), {
				code: 'QA_BLOCKED',
			});
		}
		const objectKey = `renders/${job.owner_id}/${job.episode_id}/${job.id}/output.mp4`;
		const localOutput = process.env.WORKER_LOCAL_OUTPUT_DIR;
		const localArtifactPath = localOutput ? join(localOutput, `${job.id}.mp4`) : null;
		if (localArtifactPath) {
			await mkdir(localOutput!, { recursive: true });
			await copyFile(output.path, localArtifactPath);
		} else {
			if (!r2 || !bucket) throw new Error('render_upload_unavailable');
			await r2.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: objectKey,
					Body: createReadStream(output.path),
					ContentType: 'video/mp4',
					CacheControl: 'private, no-store',
					Metadata: {
						sha256: output.sha256,
						plan: version.manifest_hash,
						qualityStatus: qualityResult.status,
					},
				}),
			);
		}
		const manifest = {
			schemaVersion: 1,
			jobId: job.id,
			planId: job.plan_id,
			planVersion: job.plan_version,
			outputProfile,
			quality,
			qa: {
				status: qualityReport.status,
				reportId: qualityReport.id,
				reportSha256: qualityReport.reportSha256,
				summary: qualityResult.report.summary,
			},
			color: validated.color ?? null,
			captionsOmitted: validated.captions.template !== 'none' && !caption,
			cta: validated.cta?.enabled
				? {
						enabled: true,
						text: validated.cta.text,
						startMs: validated.cta.startMs,
						endMs: validated.cta.endMs,
					}
				: null,
			endCard: validated.endCard ?? null,
			bucket: localOutput ? 'local-test' : bucket,
			objectKey: localArtifactPath ?? objectKey,
			durationMs: output.durationMs,
			width: output.width,
			height: output.height,
			codec: output.codec,
			container: output.container,
			byteSize: output.byteSize,
			sha256: output.sha256,
			audio: output.audio,
			audioMix: planAudioEvents.length
				? {
						masterGainDb: validated.audio?.masterGainDb ?? 0,
						eventCount: planAudioEvents.length,
						assets: [...audioAssets.values()].map((asset) => ({
							id: asset.id,
							kind: asset.kind,
							licenseStatus: asset.license_status,
							licenseName: asset.license_name,
							attribution: asset.attribution,
						})),
						events: planAudioEvents.map((event) => ({
							id: event.id,
							assetId: event.assetId,
							kind: event.kind,
							startMs: event.startMs,
							durationMs: event.durationMs,
							gainDb: event.gainDb,
							pan: event.pan,
							distance: event.distance,
							ducking: event.ducking,
							spatialPreset: event.spatialPreset,
						})),
					}
				: null,
			captions: caption
				? {
						trackId: caption.id,
						cues: caption.track.cues.length,
						style: caption.track.style,
						safeZone: caption.track.safeZone,
						narrationTakeId: caption.track.narrationTakeId,
						previewProfile: validated.preview?.profileId ?? null,
						previewVersion: validated.preview?.profileVersion ?? null,
						layoutSource: captionLayout ? 'preview' : 'legacy',
						layout: captionLayout,
						layoutHash: captionLayoutHash,
						sha256: createHash('sha256').update(JSON.stringify(caption.track)).digest('hex'),
					}
				: null,
			completedAt: new Date().toISOString(),
		};
		process.stdout.write(`${JSON.stringify(manifest)}\n`);
	} finally {
		if (ownsWork) await rm(work, { recursive: true, force: true });
	}
}

main().catch((cause) => {
	const code = safeCode(cause);
	const message = cause instanceof Error ? cause.message.slice(0, 240) : '';
	process.stderr.write(`${code}:${message}\n`);
	process.exitCode = 1;
});
