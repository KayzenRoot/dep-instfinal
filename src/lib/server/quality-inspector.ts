import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { acceptedDirectorEvents } from '#lib/domain/edit-director.js';
import { captionTextFitsBox, wrapCtaText } from '#lib/domain/caption-metrics.js';
import { assessColorRange } from '#lib/domain/color-quality.js';
import {
	assertPreviewLayout,
	PlatformPreviewError,
	resolvePreviewLayout,
} from '#lib/domain/platform-preview.js';
import type { CaptionTrack } from '#lib/schemas/captions.js';
import {
	qualityInspectionReportSchema,
	reportStatus,
	summarizeChecks,
	type QualityCheck,
	type QualityCheckStatus,
	type QualityException,
	type QualityInspectionReport,
} from '#lib/schemas/quality-report.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import type { RenderOutput } from './render-compose.js';
import { measureColorStats } from './color-quality.js';

const execFileAsync = promisify(execFile);
const MAX_LOG_CHARS = 1_000_000;

export interface QualityThresholds {
	blackWarnMs: number;
	blackBlockMs: number;
	freezeWarnMs: number;
	freezeBlockMs: number;
	silenceWarnMs: number;
	silenceBlockRatio: number;
	avDriftWarnMs: number;
	avDriftBlockMs: number;
	peakWarnDb: number;
	decodeTimeoutMs: number;
}

export function qualityThresholds(env: NodeJS.ProcessEnv = process.env): QualityThresholds {
	const read = (name: string, fallback: number): number => {
		const parsed = Number(env[name]);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	};
	return {
		blackWarnMs: read('QA_BLACK_WARN_MS', 2_000),
		blackBlockMs: read('QA_BLACK_BLOCK_MS', 5_000),
		freezeWarnMs: read('QA_FREEZE_WARN_MS', 2_000),
		freezeBlockMs: read('QA_FREEZE_BLOCK_MS', 6_000),
		silenceWarnMs: read('QA_SILENCE_WARN_MS', 2_000),
		silenceBlockRatio: 0.8,
		avDriftWarnMs: read('QA_AV_DRIFT_WARN_MS', 250),
		avDriftBlockMs: read('QA_AV_DRIFT_BLOCK_MS', 1_000),
		peakWarnDb: (() => {
			const parsed = Number(env.QA_PEAK_WARN_DB);
			return Number.isFinite(parsed) ? parsed : -0.1;
		})(),
		decodeTimeoutMs: read('QA_DECODE_TIMEOUT_MS', 300_000),
	};
}

export interface TimeRange {
	startMs: number;
	endMs: number;
}

function secondsToMs(value: string): number {
	const seconds = Number(value);
	return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1_000)) : 0;
}

export function parseBlackSegments(log: string, durationMs: number): TimeRange[] {
	const starts = [...log.matchAll(/black_start:\s*([\d.]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	const ends = [...log.matchAll(/black_end:\s*([\d.]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	return starts
		.map((startMs, index) => ({
			startMs,
			endMs: ends[index] ?? (index === starts.length - 1 ? durationMs : startMs),
		}))
		.filter((segment) => segment.endMs > segment.startMs);
}

export function parseFreezeSegments(log: string, durationMs: number): TimeRange[] {
	const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	const ends = [...log.matchAll(/freeze_end:\s*([\d.]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	return starts
		.map((startMs, index) => ({
			startMs,
			endMs: ends[index] ?? (index === starts.length - 1 ? durationMs : startMs),
		}))
		.filter((segment) => segment.endMs > segment.startMs);
}

export function parseSilenceSegments(log: string, durationMs: number): TimeRange[] {
	const starts = [...log.matchAll(/silence_start:\s*([\d.-]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) =>
		secondsToMs(match[1] ?? ''),
	);
	return starts
		.map((startMs, index) => ({
			startMs,
			endMs: ends[index] ?? (index === starts.length - 1 ? durationMs : startMs),
		}))
		.filter((segment) => segment.endMs > segment.startMs);
}

export function parsePeakDb(log: string): number | null {
	const matches = [...log.matchAll(/Peak level dB:\s*(-?[\d.]+|-inf)/gi)];
	const last = matches.at(-1)?.[1] ?? null;
	if (!last || last === '-inf') return null;
	const value = Number(last);
	return Number.isFinite(value) ? value : null;
}

export function overlapMs(left: TimeRange, right: TimeRange): number {
	return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function overlappingException(
	segment: TimeRange,
	windows: Array<TimeRange & { reason: string }>,
	checkId: string,
): QualityException | null {
	const window = windows.find((candidate) => overlapMs(segment, candidate) > 0);
	if (!window) return null;
	return {
		checkId,
		startMs: Math.max(segment.startMs, window.startMs),
		endMs: Math.min(segment.endMs, window.endMs),
		reason: window.reason,
		source: 'DIRECTOR',
	};
}

function approvedOverlapMs(
	segment: TimeRange,
	windows: Array<TimeRange & { reason: string }>,
): number {
	return Math.max(0, ...windows.map((window) => overlapMs(segment, window)));
}

function check(
	id: string,
	label: string,
	status: QualityCheckStatus,
	message: string,
	extra: Partial<QualityCheck> = {},
): QualityCheck {
	return {
		id,
		label,
		status,
		message,
		evidence: [],
		...extra,
	};
}

function directorWindows(plan: VideoEditPlan): {
	silence: Array<TimeRange & { reason: string }>;
	static: Array<TimeRange & { reason: string }>;
} {
	const map = (events: ReturnType<typeof acceptedDirectorEvents>, reason: string) =>
		events.map((event) => ({
			startMs: event.startMs,
			endMs: event.startMs + event.durationMs,
			reason,
		}));
	return {
		silence: map(
			acceptedDirectorEvents(plan.director, 'SILENCE_BEFORE_REVEAL'),
			'silêncio dramático aceito no diretor',
		),
		static: [
			...map(acceptedDirectorEvents(plan.director, 'VHS_STATIC'), 'VHS estático aceito no diretor'),
			...map(acceptedDirectorEvents(plan.director, 'CTA_CARD'), 'card de CTA aceito no diretor'),
		],
	};
}

interface DetectorRun {
	log: string;
	ok: boolean;
	timedOut: boolean;
}

async function runDetectors(input: {
	artifactPath: string;
	hasAudio: boolean;
	ffmpegPath: string;
	timeoutMs: number;
}): Promise<DetectorRun> {
	const args = [
		'-nostdin',
		'-hide_banner',
		'-nostats',
		'-v',
		'info',
		'-xerror',
		'-i',
		input.artifactPath,
		'-vf',
		'blackdetect=d=1.0:pix_th=0.10,freezedetect=n=0.003:d=2',
	];
	if (input.hasAudio) args.push('-af', 'silencedetect=noise=-45dB:d=2,astats=metadata=1:reset=0');
	args.push('-f', 'null', '-');
	try {
		const result = await execFileAsync(input.ffmpegPath, args, {
			timeout: input.timeoutMs,
			maxBuffer: 16 * 1024 * 1024,
			windowsHide: true,
		});
		return {
			log: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-MAX_LOG_CHARS),
			ok: true,
			timedOut: false,
		};
	} catch (cause) {
		const error = cause as {
			stdout?: string;
			stderr?: string;
			killed?: boolean;
			code?: string | number;
		};
		return {
			log: `${error.stdout ?? ''}\n${error.stderr ?? ''}`.slice(-MAX_LOG_CHARS),
			ok: false,
			timedOut: Boolean(error.killed) || error.code === 'ETIMEDOUT',
		};
	}
}

export interface InspectArtifactInput {
	jobId: string;
	episodeId: string;
	planId: string;
	planVersion: number;
	planSha256: string;
	plan: VideoEditPlan;
	output: RenderOutput;
	captionTrack: CaptionTrack | null;
	narrationExpected: boolean;
	hasAudioExpected: boolean;
	outputProfile: '1080p' | '720p';
	quality: 'standard' | 'high';
	ffmpegPath?: string;
	thresholds?: QualityThresholds;
}

export interface InspectArtifactResult {
	report: QualityInspectionReport;
	status: 'PASS' | 'WARN' | 'BLOCKED' | 'NOT_TESTED';
	reportSha256: string;
}

export async function inspectRenderArtifact(
	input: InspectArtifactInput,
): Promise<InspectArtifactResult> {
	const thresholds = input.thresholds ?? qualityThresholds();
	const checks: QualityCheck[] = [];
	const exceptions: QualityException[] = [];
	const expectedWidth = input.outputProfile === '720p' ? 720 : 1080;
	const expectedHeight = input.outputProfile === '720p' ? 1280 : 1920;
	const durationMs = input.output.durationMs;

	const artifactStat = await stat(input.output.path);
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(input.output.path)) hash.update(chunk);
	const sha256 = hash.digest('hex');
	const hashMatches = sha256 === input.output.sha256 && artifactStat.size === input.output.byteSize;
	checks.push(
		check(
			'ARTIFACT_HASH',
			'Hash e tamanho do artefato',
			hashMatches ? 'PASS' : 'BLOCKED',
			hashMatches
				? 'SHA-256 e tamanho conferem com o render.'
				: 'SHA-256 ou tamanho não conferem com o render.',
			{
				severity: hashMatches ? undefined : 'HIGH',
				evidence: [{ value: artifactStat.size, unit: 'bytes', detail: sha256 }],
			},
		),
	);

	checks.push(
		check(
			'PLAN_HASH',
			'Vínculo plano ↔ artefato',
			input.planSha256.match(/^[0-9a-f]{64}$/) ? 'PASS' : 'BLOCKED',
			'O relatório referencia o hash do plano versionado.',
			{ evidence: [{ detail: input.planSha256 }] },
		),
	);

	const fpsOk = input.output.fps >= 29 && input.output.fps <= 31;
	const pixFmtOk = input.output.pixelFormat === 'yuv420p';
	const containerOk =
		input.output.codec === 'h264' &&
		input.output.width === expectedWidth &&
		input.output.height === expectedHeight &&
		fpsOk &&
		pixFmtOk;
	checks.push(
		check(
			'CONTAINER',
			'Codec, geometria, fps e pix format',
			containerOk ? 'PASS' : 'BLOCKED',
			containerOk
				? `H.264 ${expectedWidth}x${expectedHeight} yuv420p ${input.output.fps.toFixed(2)} fps.`
				: `Esperado H.264 ${expectedWidth}x${expectedHeight} yuv420p ~30 fps; recebido ${input.output.codec} ${input.output.width}x${input.output.height} ${input.output.pixelFormat} ${input.output.fps.toFixed(2)} fps.`,
			{
				severity: containerOk ? undefined : 'HIGH',
				evidence: [
					{ value: input.output.width, unit: 'px' },
					{ value: input.output.height, unit: 'px' },
					{ value: input.output.fps, unit: 'fps' },
					{ value: input.output.durationMs, unit: 'ms' },
					{ detail: input.output.pixelFormat },
				],
			},
		),
	);

	const durationDelta = Math.abs(input.output.durationMs - input.plan.durationMs);
	checks.push(
		check(
			'DURATION',
			'Duração planejada',
			durationDelta <= 1_000 ? 'PASS' : 'BLOCKED',
			durationDelta <= 1_000
				? 'Duração do artefato acompanha o plano.'
				: `Duração diverge do plano em ${durationDelta} ms.`,
			{
				severity: durationDelta <= 1_000 ? undefined : 'HIGH',
				tolerance: '±1000 ms',
				evidence: [
					{ value: input.output.durationMs, unit: 'ms' },
					{ value: input.plan.durationMs, unit: 'ms' },
				],
			},
		),
	);

	const audioOk =
		!input.hasAudioExpected ||
		(Boolean(input.output.audio) &&
			input.output.audio?.codec === 'aac' &&
			input.output.audio?.channels === 2 &&
			input.output.audio?.sampleRate === 48_000);
	checks.push(
		check(
			'AUDIO_STREAM',
			'Faixa de áudio AAC estéreo',
			audioOk ? 'PASS' : 'BLOCKED',
			audioOk
				? input.hasAudioExpected
					? 'AAC 48 kHz estéreo presente.'
					: 'Plano sem áudio; nenhuma faixa exigida.'
				: 'Faixa AAC 48 kHz estéreo ausente ou inválida.',
			{ severity: audioOk ? undefined : 'HIGH' },
		),
	);

	if (input.output.audio) {
		const driftMs = Math.abs(input.output.audio.durationMs - durationMs);
		const driftStatus: QualityCheckStatus =
			driftMs > thresholds.avDriftBlockMs
				? 'BLOCKED'
				: driftMs > thresholds.avDriftWarnMs
					? 'WARN'
					: 'PASS';
		checks.push(
			check(
				'AV_DRIFT',
				'Sincronia áudio/vídeo',
				driftStatus,
				`Drift de ${driftMs} ms entre áudio e vídeo.`,
				{
					severity: driftStatus === 'PASS' ? undefined : driftStatus === 'WARN' ? 'MEDIUM' : 'HIGH',
					tolerance: `≤ ${thresholds.avDriftWarnMs} ms`,
					evidence: [{ value: driftMs, unit: 'ms' }],
				},
			),
		);
	} else {
		checks.push(
			check(
				'AV_DRIFT',
				'Sincronia áudio/vídeo',
				input.hasAudioExpected ? 'BLOCKED' : 'NOT_TESTED',
				input.hasAudioExpected
					? 'Não há áudio para comparar com o vídeo.'
					: 'Sem áudio esperado; drift não se aplica.',
			),
		);
	}

	if (input.plan.color) {
		try {
			const stats = await measureColorStats(input.output.path, {
				ffmpegPath: input.ffmpegPath,
				timeoutMs: thresholds.decodeTimeoutMs,
			});
			const range = assessColorRange(stats);
			checks.push(
				check('COLOR_RANGE', 'Faixa tonal do Color Match', range.status, range.message, {
					severity: range.severe ? 'MEDIUM' : undefined,
					tolerance: 'clipping < 20% em sombras e altas luzes',
					evidence: [
						{ value: Number(stats.lowClipPct.toFixed(2)), unit: '%' },
						{ value: Number(stats.highClipPct.toFixed(2)), unit: '%' },
						{ value: Number(stats.p05Luma.toFixed(1)), unit: 'luma' },
						{ value: Number(stats.p95Luma.toFixed(1)), unit: 'luma' },
					],
				}),
			);
		} catch {
			checks.push(
				check(
					'COLOR_RANGE',
					'Faixa tonal do Color Match',
					'NOT_TESTED',
					'Não foi possível medir a faixa tonal do render graduado.',
				),
			);
		}
	}

	const detector = await runDetectors({
		artifactPath: input.output.path,
		hasAudio: Boolean(input.output.audio),
		ffmpegPath: input.ffmpegPath ?? 'ffmpeg',
		timeoutMs: thresholds.decodeTimeoutMs,
	});
	const decodeError = /(^|\n)\[?error\]?|Error while decoding|Invalid data found/i.test(
		detector.log,
	);
	const decodeStatus: QualityCheckStatus = detector.ok && !decodeError ? 'PASS' : 'BLOCKED';
	checks.push(
		check(
			'DECODE',
			'Decodificação integral',
			decodeStatus,
			detector.timedOut
				? 'A decodificação excedeu o tempo limite.'
				: decodeStatus === 'PASS'
					? 'Todos os frames decodificaram sem erro.'
					: 'A decodificação encontrou erros ou dados inválidos.',
			{
				severity: decodeStatus === 'PASS' ? undefined : 'HIGH',
				tolerance: `${thresholds.decodeTimeoutMs} ms`,
			},
		),
	);

	const windows = directorWindows(input.plan);
	if (input.output.audio && input.output.audio.paddedMs > 0) {
		windows.silence.push({
			startMs: Math.max(0, durationMs - input.output.audio.paddedMs),
			endMs: durationMs,
			reason: 'pad intencional da narração até a duração do vídeo',
		});
	}
	const black = parseBlackSegments(detector.log, durationMs);
	if (!black.length) {
		checks.push(check('BLACK_FRAMES', 'Quadros pretos', 'PASS', 'Nenhum trecho preto detectado.'));
	} else {
		const findings: QualityCheck['evidence'] = [];
		let warn = false;
		let severe = false;
		for (const segment of black) {
			const duration = segment.endMs - segment.startMs;
			const approvedMs = approvedOverlapMs(segment, windows.static);
			const exception = overlappingException(segment, windows.static, 'BLACK_FRAMES');
			if (exception) exceptions.push(exception);
			const remaining = Math.max(0, duration - approvedMs);
			if (remaining >= thresholds.blackWarnMs) {
				warn = true;
				if (remaining >= thresholds.blackBlockMs) severe = true;
			}
			findings.push({
				startMs: segment.startMs,
				endMs: segment.endMs,
				value: remaining,
				unit: 'ms',
				detail: exception ? `${exception.reason}; ${approvedMs} ms aprovados` : undefined,
			});
		}
		checks.push(
			check(
				'BLACK_FRAMES',
				'Quadros pretos',
				warn ? 'WARN' : 'PASS',
				`${black.length} trecho(s) preto(s) detectado(s).`,
				{
					severity: warn ? (severe ? 'HIGH' : 'MEDIUM') : undefined,
					tolerance: `WARN ≥ ${thresholds.blackWarnMs} ms; HIGH ≥ ${thresholds.blackBlockMs} ms`,
					evidence: findings,
				},
			),
		);
	}

	const freeze = parseFreezeSegments(detector.log, durationMs);
	if (!freeze.length) {
		checks.push(check('FREEZE_FRAMES', 'Quadros congelados', 'PASS', 'Nenhum freeze detectado.'));
	} else {
		const findings: QualityCheck['evidence'] = [];
		let warn = false;
		let severe = false;
		for (const segment of freeze) {
			const duration = segment.endMs - segment.startMs;
			const approvedMs = approvedOverlapMs(segment, windows.static);
			const exception = overlappingException(segment, windows.static, 'FREEZE_FRAMES');
			if (exception) exceptions.push(exception);
			const remaining = Math.max(0, duration - approvedMs);
			if (remaining >= thresholds.freezeWarnMs) {
				warn = true;
				if (remaining >= thresholds.freezeBlockMs) severe = true;
			}
			findings.push({
				startMs: segment.startMs,
				endMs: segment.endMs,
				value: remaining,
				unit: 'ms',
				detail: exception ? `${exception.reason}; ${approvedMs} ms aprovados` : undefined,
			});
		}
		checks.push(
			check(
				'FREEZE_FRAMES',
				'Quadros congelados',
				warn ? 'WARN' : 'PASS',
				`${freeze.length} freeze(s) detectado(s).`,
				{
					severity: warn ? (severe ? 'HIGH' : 'MEDIUM') : undefined,
					tolerance: `WARN ≥ ${thresholds.freezeWarnMs} ms; HIGH ≥ ${thresholds.freezeBlockMs} ms`,
					evidence: findings,
				},
			),
		);
	}

	const silence = parseSilenceSegments(detector.log, durationMs);
	if (!input.output.audio) {
		checks.push(
			check(
				'SILENCE',
				'Silêncio de áudio',
				input.hasAudioExpected ? 'BLOCKED' : 'NOT_TESTED',
				input.hasAudioExpected ? 'Sem áudio para analisar.' : 'Plano sem áudio.',
			),
		);
	} else if (!silence.length) {
		checks.push(check('SILENCE', 'Silêncio de áudio', 'PASS', 'Nenhum silêncio ≥ 2 s detectado.'));
	} else {
		const findings: QualityCheck['evidence'] = [];
		let warn = false;
		let silentMs = 0;
		for (const segment of silence) {
			const duration = segment.endMs - segment.startMs;
			const approvedMs = approvedOverlapMs(segment, windows.silence);
			const exception = overlappingException(segment, windows.silence, 'SILENCE');
			if (exception) exceptions.push(exception);
			const remaining = Math.max(0, duration - approvedMs);
			silentMs += remaining;
			if (remaining >= thresholds.silenceWarnMs) warn = true;
			findings.push({
				startMs: segment.startMs,
				endMs: segment.endMs,
				value: remaining,
				unit: 'ms',
				detail: exception ? `${exception.reason}; ${approvedMs} ms aprovados` : undefined,
			});
		}
		const ratio = durationMs ? silentMs / durationMs : 0;
		const severe = ratio >= thresholds.silenceBlockRatio;
		checks.push(
			check(
				'SILENCE',
				'Silêncio de áudio',
				warn || severe ? 'WARN' : 'PASS',
				`${silence.length} trecho(s) de silêncio; ${Math.round(ratio * 100)}% sem áudio não justificado.`,
				{
					severity: warn || severe ? (severe ? 'HIGH' : 'MEDIUM') : undefined,
					tolerance: `WARN ≥ ${thresholds.silenceWarnMs} ms; HIGH ≥ ${Math.round(thresholds.silenceBlockRatio * 100)}%`,
					evidence: findings,
				},
			),
		);
	}

	const peakDb = parsePeakDb(detector.log);
	checks.push(
		check(
			'CLIPPING',
			'Pico de áudio',
			peakDb === null ? 'NOT_TESTED' : peakDb > thresholds.peakWarnDb ? 'WARN' : 'PASS',
			peakDb === null ? 'Pico de áudio indisponível.' : `Pico medido em ${peakDb.toFixed(2)} dBFS.`,
			{
				severity: peakDb !== null && peakDb > thresholds.peakWarnDb ? 'MEDIUM' : undefined,
				tolerance: `≤ ${thresholds.peakWarnDb} dBFS`,
				evidence: peakDb === null ? [] : [{ value: peakDb, unit: 'dBFS' }],
			},
		),
	);

	const lufs = input.output.audio?.lufs ?? null;
	checks.push(
		check(
			'LOUDNESS',
			'Nível integrado de áudio',
			lufs === null ? 'NOT_TESTED' : lufs < -20 || lufs > -12 ? 'WARN' : 'PASS',
			lufs === null
				? 'Loudness integrado indisponível para este tipo de mix.'
				: `Nível integrado em ${lufs.toFixed(1)} LUFS.`,
			{
				severity: lufs !== null && (lufs < -20 || lufs > -12) ? 'MEDIUM' : undefined,
				tolerance: '−20 a −12 LUFS',
				evidence: lufs === null ? [] : [{ value: lufs, unit: 'LUFS' }],
			},
		),
	);

	if (!input.plan.preview) {
		checks.push(
			check(
				'SAFE_AREA',
				'Safe area legenda/CTA',
				'NOT_TESTED',
				'Plano legado sem preview; render usa o layout histórico de 880 px.',
			),
		);
	} else {
		try {
			const layout = assertPreviewLayout(input.plan.preview, {
				caption: input.plan.captions.template !== 'none',
				cta: Boolean(input.plan.cta?.enabled),
			});
			checks.push(
				check(
					'SAFE_AREA',
					'Safe area legenda/CTA',
					'PASS',
					'Caixas canônicas dentro da área segura do perfil.',
					{
						evidence: [
							{ detail: `caption ${JSON.stringify(layout.captionBox)}` },
							{ detail: `cta ${JSON.stringify(layout.ctaBox)}` },
						],
					},
				),
			);
		} catch (cause) {
			const message =
				cause instanceof PlatformPreviewError ? cause.message : 'Layout de preview inválido.';
			checks.push(
				check('SAFE_AREA', 'Safe area legenda/CTA', 'BLOCKED', message, { severity: 'HIGH' }),
			);
		}
	}

	if (input.plan.captions.template === 'none') {
		checks.push(
			check('CAPTIONS', 'Legendas queimadas', 'PASS', 'Template de legendas desativado no plano.'),
		);
	} else if (input.captionTrack) {
		checks.push(
			check(
				'CAPTIONS',
				'Legendas queimadas',
				'PASS',
				`Track aprovada com ${input.captionTrack.cues.length} cue(s) usada no render.`,
				{ evidence: [{ value: input.captionTrack.cues.length, unit: 'cues' }] },
			),
		);
	} else {
		checks.push(
			check(
				'CAPTIONS',
				'Legendas queimadas',
				'WARN',
				'Plano pede legendas, mas não há track aprovada para esta versão; o MP4 saiu sem legendas.',
				{ severity: 'HIGH' },
			),
		);
	}

	if (input.plan.cta?.enabled && input.plan.captions.template === 'none') {
		checks.push(
			check(
				'CTA',
				'CTA de duas escolhas',
				'BLOCKED',
				'CTA habilitada, mas o template de legendas está desativado; a CTA não entraria no MP4.',
				{ severity: 'HIGH' },
			),
		);
	} else if (input.plan.cta?.enabled) {
		const layout = resolvePreviewLayout(input.plan.preview);
		const chunks = wrapCtaText(input.plan.cta.text, layout.ctaBox.width - 20);
		const fits = chunks.every((chunk) => captionTextFitsBox(chunk, layout.ctaBox));
		const hasCtaCue = input.captionTrack?.cues.some((cue) => cue.role === 'CTA') ?? false;
		if (!fits || !hasCtaCue) {
			checks.push(
				check(
					'CTA',
					'CTA de duas escolhas',
					'BLOCKED',
					!fits
						? 'O texto da CTA não cabe na caixa segura.'
						: 'A track aprovada não contém cue de CTA.',
					{ severity: 'HIGH' },
				),
			);
		} else {
			checks.push(
				check('CTA', 'CTA de duas escolhas', 'PASS', 'Texto e cue de CTA presentes e seguros.'),
			);
		}
	} else {
		checks.push(check('CTA', 'CTA de duas escolhas', 'PASS', 'CTA desativada no plano.'));
	}

	if (input.narrationExpected) {
		checks.push(
			check(
				'NARRATION',
				'Narração',
				input.output.audio ? 'PASS' : 'BLOCKED',
				input.output.audio ? 'Faixa de narração presente.' : 'Narração esperada, mas ausente.',
				{ severity: input.output.audio ? undefined : 'HIGH' },
			),
		);
	}

	checks.push(
		check(
			'OUTPUT_PROFILE',
			'Perfil de saída',
			'PASS',
			`Saída solicitada: ${input.outputProfile} / ${input.quality}.`,
			{
				evidence: [
					{ detail: input.outputProfile },
					{ detail: input.quality },
					{ value: input.output.byteSize, unit: 'bytes' },
				],
			},
		),
	);

	const boundedChecks = checks.map((item) => ({
		...item,
		evidence: item.evidence.slice(0, 50),
	}));
	const report: QualityInspectionReport = qualityInspectionReportSchema.parse({
		schemaVersion: 1,
		jobId: input.jobId,
		episodeId: input.episodeId,
		planId: input.planId,
		planVersion: input.planVersion,
		planSha256: input.planSha256,
		artifact: {
			sha256: input.output.sha256,
			byteSize: input.output.byteSize,
			durationMs: input.output.durationMs,
			width: input.output.width,
			height: input.output.height,
			fps: input.output.fps,
			videoCodec: input.output.codec,
			pixelFormat: input.output.pixelFormat,
			audioCodec: input.output.audio?.codec ?? null,
			audioChannels: input.output.audio?.channels ?? 0,
			sampleRate: input.output.audio?.sampleRate ?? 0,
		},
		summary: summarizeChecks(boundedChecks),
		checks: boundedChecks,
		exceptions,
		inspectedAt: new Date().toISOString(),
	});
	const canonical = JSON.stringify(report);
	return {
		report,
		status: reportStatus(boundedChecks),
		reportSha256: createHash('sha256').update(canonical).digest('hex'),
	};
}
