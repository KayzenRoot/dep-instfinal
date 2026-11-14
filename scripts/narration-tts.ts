/**
 * WO-007 local TTS runner. Generates one WAV per voice-direction segment,
 * inserts configurable pauses/gain, stitches a single narration take and
 * optionally uploads it to private R2. Emotion is reported as unsupported by
 * Piper: speed, volume and pauses are the real controls. Run with:
 *   npx tsx scripts/narration-tts.ts
 */
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { voiceDirectionPlanSchema } from '../src/lib/schemas/voice-direction.js';
import { applyPronunciation, narrationTextHash } from '../src/lib/domain/voice-direction.js';

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 48_000;
const TARGET_MIN_MS = 90_000;
const TARGET_MAX_MS = 150_000;
const MAX_TAKE_BYTES = 20 * 1024 * 1024;

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`missing_${name.toLowerCase()}`);
	return value;
}

function minimalEnv(): NodeJS.ProcessEnv {
	return { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot };
}

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function segmentFileName(index: number, id: string): string {
	return `${String(index + 1).padStart(2, '0')}-${id}.wav`;
}

async function synthesize(text: string, output: string, lengthScale: number): Promise<void> {
	const python = process.env.PIPER_PYTHON?.trim();
	const piper = python ?? required('PIPER_BIN');
	const model = required('PIPER_MODEL');
	const textFile = `${output}.txt`;
	let args: string[];
	if (python) {
		await writeFile(textFile, `${text}\n`, 'utf8');
		args = [
			'-m',
			'piper',
			'-m',
			model,
			'-i',
			textFile,
			'-f',
			output,
			'--length_scale',
			lengthScale.toFixed(3),
			'--sentence-silence',
			'0.0',
		];
	} else {
		args = ['-m', model, '-f', output, '--length_scale', lengthScale.toFixed(3)];
		if (process.env.PIPER_ESPEAK_DATA) args.push('--espeak_data', process.env.PIPER_ESPEAK_DATA);
	}
	const requestedTimeout = Number(process.env.TTS_TIMEOUT_MS ?? 120_000);
	const timeoutMs = Number.isFinite(requestedTimeout)
		? Math.max(5_000, Math.min(600_000, requestedTimeout))
		: 120_000;
	try {
		await new Promise<void>((resolvePromise, reject) => {
			const child = spawn(piper, args, {
				stdio: ['pipe', 'ignore', 'pipe'],
				windowsHide: true,
				env: minimalEnv(),
			});
			let stderr = '';
			let settled = false;
			const finish = (cause?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (cause) reject(cause);
				else resolvePromise();
			};
			const timer = setTimeout(() => {
				child.kill();
				finish(new Error('piper_timeout'));
			}, timeoutMs);
			child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
			child.on('error', (cause) => finish(cause));
			child.on('exit', (code) => {
				if (code === 0) finish();
				else finish(new Error(`piper_exit_${code ?? 1}:${stderr.slice(0, 200)}`));
			});
			child.stdin?.end(python ? undefined : `${text}\n`);
		});
	} finally {
		await rm(textFile, { force: true }).catch(() => undefined);
	}
}

async function runFfmpeg(args: string[], timeout = 120_000): Promise<string> {
	const result = await execFileAsync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
		timeout,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
		env: minimalEnv(),
	}).catch((cause: { stderr?: string; message?: string }) => {
		throw new Error(`ffmpeg_failed:${(cause.stderr ?? cause.message ?? '').slice(-400)}`);
	});
	return result.stderr;
}

async function measure(path: string): Promise<{
	durationMs: number;
	peakDb: number | null;
	rmsDb: number | null;
	truePeakDb: number | null;
	lufs: number | null;
	size: number;
}> {
	const { stdout } = await execFileAsync(
		'ffprobe',
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
		{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: minimalEnv() },
	);
	const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
	const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
	const volumeStderr = await execFileAsync(
		'ffmpeg',
		['-hide_banner', '-nostdin', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
		{ timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: minimalEnv() },
	)
		.then((result) => result.stderr)
		.catch((cause: { stderr?: string }) => cause.stderr ?? '');
	const peak = /max_volume:\s*(-?[0-9.]+) dB/.exec(volumeStderr);
	const rms = /mean_volume:\s*(-?[0-9.]+) dB/.exec(volumeStderr);
	const eburStderr = await execFileAsync(
		'ffmpeg',
		['-hide_banner', '-nostdin', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
		{ timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: minimalEnv() },
	)
		.then((result) => result.stderr)
		.catch((cause: { stderr?: string }) => cause.stderr ?? '');
	const truePeaks = [...eburStderr.matchAll(/True peak:\s*Peak:\s*(-?[0-9.]+) dBFS/g)];
	const lufsValues = [...eburStderr.matchAll(/\bI:\s*(-?[0-9.]+) LUFS/g)];
	const truePeak = truePeaks.at(-1);
	const lufs = lufsValues.at(-1);
	return {
		durationMs,
		peakDb: peak ? Number(peak[1]) : null,
		rmsDb: rms ? Number(rms[1]) : null,
		truePeakDb: truePeak ? Number(truePeak[1]) : null,
		lufs: lufs ? Number(lufs[1]) : null,
		size: (await stat(path)).size,
	};
}

async function uploadTake(input: {
	takePath: string;
	episodeId: string;
	planVersion: number;
	evidence: {
		durationMs: number;
		peakDb: number | null;
		rmsDb: number | null;
		truePeakDb: number | null;
		lufs: number | null;
		format: string;
		sha256: string;
		byteSize: number;
	};
	voice: string | null;
	license: string | null;
	modelSha256: string;
}): Promise<string> {
	const url = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('missing_supabase_upload_config');
	const endpoint = process.env.R2_ENDPOINT;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.R2_BUCKET;
	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket)
		throw new Error('missing_r2_config');
	const admin = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});
	const { data: episode, error: episodeError } = await admin
		.from('episodes')
		.select('id,owner_id')
		.eq('id', input.episodeId)
		.maybeSingle();
	if (episodeError || !episode) throw new Error('episode_not_found');
	const takeId = crypto.randomUUID();
	const objectKey = `narration/${episode.owner_id}/${input.episodeId}/${takeId}.wav`;
	const bytes = await readFile(input.takePath);
	if (sha256(bytes) !== input.evidence.sha256) throw new Error('tts_take_changed_before_upload');
	const r2 = new S3Client({
		region: 'auto',
		endpoint,
		credentials: { accessKeyId, secretAccessKey },
	});
	await r2.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: objectKey,
			Body: bytes,
			ContentType: 'audio/wav',
			CacheControl: 'private, no-store',
		}),
	);
	const { error } = await admin.from('narration_takes').insert({
		id: takeId,
		owner_id: episode.owner_id,
		episode_id: input.episodeId,
		plan_version: input.planVersion,
		source: 'TTS',
		status: 'READY',
		bucket,
		object_key: objectKey,
		sha256: input.evidence.sha256,
		byte_size: input.evidence.byteSize,
		duration_ms: input.evidence.durationMs,
		format: input.evidence.format,
		sample_rate: SAMPLE_RATE,
		channels: 1,
		peak_db: input.evidence.peakDb,
		rms_db: input.evidence.rmsDb,
		true_peak_db: input.evidence.truePeakDb,
		lufs: input.evidence.lufs,
		model_id: input.voice ? `piper:${input.voice}` : 'piper',
		model_license: input.license,
		model_sha256: input.modelSha256,
	});
	if (error) {
		await r2
			.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
			.catch(() => undefined);
		throw new Error(`narration_take_insert_failed:${error.message}`);
	}
	return takeId;
}

async function main() {
	const planFile = required('TTS_PLAN_FILE');
	const outputDir = resolve(required('TTS_OUTPUT_DIR'));
	await mkdir(outputDir, { recursive: true });
	const plan = voiceDirectionPlanSchema.parse(JSON.parse(await readFile(planFile, 'utf8')));
	const selectedSegment = process.env.TTS_SEGMENT_ID?.trim() || null;
	const gainDb = Number(process.env.TTS_GAIN_DB ?? -1.5);
	if (!Number.isFinite(gainDb)) throw new Error('invalid_tts_gain_db');
	const piperVoice = process.env.PIPER_VOICE?.trim() || null;
	const license = process.env.PIPER_MODEL_LICENSE?.trim() || null;
	const modelPath = required('PIPER_MODEL');
	const modelBytes = await readFile(modelPath);
	const modelSha256 = sha256(modelBytes);
	if (process.env.PIPER_MODEL_SHA256 && process.env.PIPER_MODEL_SHA256 !== modelSha256)
		throw new Error('piper_model_sha256_mismatch');
	if (selectedSegment && !plan.segments.some((segment) => segment.id === selectedSegment))
		throw new Error('tts_segment_not_found');

	const generated: Array<{
		id: string;
		index: number;
		file: string;
		textForTts: string;
		speechMs: number;
		paddedMs: number;
		startMs: number;
		endMs: number;
		emotion: string;
		speed: number;
		volumeDb: number;
		intendedWpm: number;
		effectiveWpm: number;
		peakDb: number | null;
		rmsDb: number | null;
		truePeakDb: number | null;
		lufs: number | null;
	}> = [];
	let cursorMs = 0;
	for (const [index, segment] of plan.segments.entries()) {
		const file = resolve(outputDir, segmentFileName(index, segment.id));
		const textForTts = applyPronunciation(segment.text, segment.pronunciation);
		const isSelected = selectedSegment === null || selectedSegment === segment.id;
		if (isSelected) {
			const raw = resolve(outputDir, `.raw-${index + 1}.wav`);
			const lengthScale = clamp(1 / segment.speed, 0.5, 2);
			await synthesize(textForTts, raw, lengthScale);
			const padded = resolve(outputDir, `.padded-${index + 1}.wav`);
			const gain = clamp(gainDb + segment.volumeDb, -24, 12);
			await runFfmpeg([
				'-i',
				raw,
				'-af',
				[
					'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02',
					'areverse',
					'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02',
					'areverse',
					`volume=${gain}dB`,
					'alimiter=limit=0.7:level=false',
					`adelay=${segment.pauseBeforeMs}:all=1`,
					`apad=pad_dur=${(segment.pauseAfterMs / 1000).toFixed(3)}`,
					'aresample=48000',
				].join(','),
				'-ac',
				'1',
				'-c:a',
				'pcm_s16le',
				padded,
			]);
			const measured = await measure(padded);
			if (!Number.isFinite(measured.durationMs) || measured.durationMs <= 0)
				throw new Error('tts_segment_empty');
			if (
				(measured.truePeakDb !== null && measured.truePeakDb > -0.5) ||
				(measured.peakDb !== null && measured.peakDb > -0.5)
			)
				throw new Error('tts_clipping');
			await writeFile(file, await readFile(padded));
			await Promise.all([rm(raw, { force: true }), rm(padded, { force: true })]);
		} else {
			await stat(file).catch(() => {
				throw new Error(`tts_segment_missing:${segment.id}`);
			});
		}
		const measured = await measure(file);
		const speechMs = Math.max(
			1,
			measured.durationMs - segment.pauseBeforeMs - segment.pauseAfterMs,
		);
		const words = textForTts.trim().split(/\s+/).filter(Boolean).length;
		const effectiveWpm = speechMs > 0 ? (words / speechMs) * 60_000 : 0;
		const startMs = cursorMs;
		const endMs = startMs + measured.durationMs;
		cursorMs = endMs;
		generated.push({
			id: segment.id,
			index,
			file,
			textForTts,
			speechMs,
			paddedMs: measured.durationMs,
			startMs,
			endMs,
			emotion: segment.emotion,
			speed: segment.speed,
			volumeDb: segment.volumeDb,
			intendedWpm: segment.intendedWpm,
			effectiveWpm: Math.round(effectiveWpm * 10) / 10,
			peakDb: measured.peakDb,
			rmsDb: measured.rmsDb,
			truePeakDb: measured.truePeakDb,
			lufs: measured.lufs,
		});
	}

	const listPath = resolve(outputDir, 'concat.txt');
	const list = generated
		.map((segment) => {
			const normalized = segment.file.replace(/\\/g, '/');
			if (normalized.includes("'")) throw new Error('tts_path_has_quote');
			return `file '${normalized}'`;
		})
		.join('\n');
	await writeFile(listPath, `${list}\n`, 'utf8');
	const narrationPath = resolve(outputDir, 'narration.wav');
	await runFfmpeg([
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		listPath,
		'-ac',
		'1',
		'-ar',
		String(SAMPLE_RATE),
		'-c:a',
		'pcm_s16le',
		narrationPath,
	]);
	const final = await measure(narrationPath);
	if (final.size > MAX_TAKE_BYTES) throw new Error(`tts_take_too_large:${final.size}`);
	if (
		(final.truePeakDb !== null && final.truePeakDb > -0.5) ||
		(final.peakDb !== null && final.peakDb > -0.5)
	)
		throw new Error('tts_clipping');
	const bytes = await readFile(narrationPath);
	const evidence = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		episodeId: plan.episodeId,
		narrationTextSha256:
			plan.narrationTextSha256 ??
			narrationTextHash(plan.segments.map((segment) => segment.text).join(' ')),
		provider: 'piper-local',
		model: piperVoice,
		modelPath: basename(modelPath),
		modelSha256,
		modelLicense: license,
		capability: {
			emotion: false,
			speed: true,
			pause: true,
			volume: true,
			pronunciationMap: true,
		},
		targetRangeMs: [TARGET_MIN_MS, TARGET_MAX_MS],
		withinTarget: final.durationMs >= TARGET_MIN_MS && final.durationMs <= TARGET_MAX_MS,
		totalMs: final.durationMs,
		peakDb: final.peakDb,
		rmsDb: final.rmsDb,
		truePeakDb: final.truePeakDb,
		lufs: final.lufs,
		clipping: (final.truePeakDb ?? final.peakDb ?? -99) > -0.5,
		sha256: sha256(bytes),
		byteSize: final.size,
		format: 'wav',
		sampleRate: SAMPLE_RATE,
		channels: 1,
		narrationFile: basename(narrationPath),
		segmentCount: generated.length,
		segments: generated.map((segment) => ({
			id: segment.id,
			index: segment.index,
			file: basename(segment.file),
			textForTts: segment.textForTts,
			emotion: segment.emotion,
			speed: segment.speed,
			volumeDb: segment.volumeDb,
			intendedWpm: segment.intendedWpm,
			effectiveWpm: segment.effectiveWpm,
			speechMs: segment.speechMs,
			paddedMs: segment.paddedMs,
			startMs: segment.startMs,
			endMs: segment.endMs,
			peakDb: segment.peakDb,
			rmsDb: segment.rmsDb,
			truePeakDb: segment.truePeakDb,
			lufs: segment.lufs,
		})),
	};
	const reportPath = resolve(outputDir, 'report.json');
	await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	let uploadedTakeId: string | null = null;
	if (process.env.TTS_UPLOAD === '1') {
		if (!license) throw new Error('missing_model_license_for_upload');
		const planVersion = Number(process.env.TTS_PLAN_VERSION ?? 0);
		if (!Number.isInteger(planVersion) || planVersion < 0)
			throw new Error('invalid_tts_plan_version');
		uploadedTakeId = await uploadTake({
			takePath: narrationPath,
			episodeId: plan.episodeId,
			planVersion,
			evidence: {
				durationMs: final.durationMs,
				peakDb: final.peakDb,
				rmsDb: final.rmsDb,
				truePeakDb: final.truePeakDb,
				lufs: final.lufs,
				format: 'wav',
				sha256: evidence.sha256,
				byteSize: final.size,
			},
			voice: piperVoice,
			license,
			modelSha256,
		});
	}
	process.stdout.write(
		`${JSON.stringify({
			narrationFile: narrationPath,
			reportFile: reportPath,
			durationMs: final.durationMs,
			withinTarget: evidence.withinTarget,
			segments: generated.length,
			uploadedTakeId,
		})}\n`,
	);
}

main().catch((cause) => {
	process.stderr.write(`${cause instanceof Error ? cause.message : 'tts_failed'}\n`);
	process.exitCode = 1;
});
