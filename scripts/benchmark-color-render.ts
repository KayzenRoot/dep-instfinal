import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRenderCommand } from '../src/lib/domain/render-composition.js';
import type { ColorGrade } from '../src/lib/schemas/color-grade.js';

const DURATION_SECONDS = 10;
const WIDTH = 540;
const HEIGHT = 960;
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const CLIP_ID = '33333333-3333-4333-8333-333333333333';
const SCENE_ID = '44444444-4444-4444-8444-444444444444';
const ffmpegBinary =
	process.env.FFMPEG_PATH ??
	(process.platform === 'win32'
		? join(process.env.LOCALAPPDATA ?? 'C:\\Windows', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
		: '/usr/bin/ffmpeg');

function plan(color: ColorGrade | null) {
	return {
		schemaVersion: 1 as const,
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 1,
		durationMs: DURATION_SECONDS * 1_000,
		sceneDurationMs: 4_000 as const,
		fps: 30 as const,
		tracks: [{ id: 'video-main', kind: 'video' as const, label: 'Vídeo principal' }],
		clips: [
			{
				id: CLIP_ID,
				sceneId: SCENE_ID,
				assetId: ASSET_ID,
				trackId: 'video-main',
				sourceInMs: 0,
				sourceOutMs: DURATION_SECONDS * 1_000,
				timelineStartMs: 0,
				timelineEndMs: DURATION_SECONDS * 1_000,
				transition: 'cut' as const,
				transitionMs: 0,
				gainDb: 0,
			},
		],
		captions: { template: 'clean' as const },
		cta: null,
		...(color ? { color } : {}),
	};
}

function parseBenchmark(stderr: string) {
	const times = /bench:\s*utime=([\d.]+)s\s+stime=([\d.]+)s\s+rtime=([\d.]+)s/.exec(stderr);
	const rss = /bench:\s*maxrss=\s*(\d+)\s*KiB/i.exec(stderr);
	return {
		cpuSeconds: times ? Number(times[1]) + Number(times[2]) : null,
		ffmpegSeconds: times ? Number(times[3]) : null,
		maxRssKib: rss ? Number(rss[1]) : null,
	};
}

const grade: ColorGrade = {
	presetId: 'cursed_tape',
	presetVersion: 1,
	strength: 80,
	referenceClipId: null,
	overrides: [],
};

const enabled = (() => {
	try {
		execFileSync(ffmpegBinary, ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

if (!enabled) {
	console.error('ffmpeg não encontrado; benchmark de cor ignorado.');
	process.exit(2);
}

const workspace = await mkdtemp(join(tmpdir(), 'dif-color-bench-'));
try {
	const source = join(workspace, 'source.mp4');
	execFileSync(
		ffmpegBinary,
		[
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			`testsrc2=s=${WIDTH}x${HEIGHT}:r=30:d=${DURATION_SECONDS}`,
			'-c:v',
			'libx264',
			'-preset',
			'ultrafast',
			'-pix_fmt',
			'yuv420p',
			source,
		],
		{ timeout: 120_000, windowsHide: true },
	);
	const results = [];
	for (const profile of [
		{ name: '720p', width: 720, height: 1280 },
		{ name: '1080p', width: 1080, height: 1920 },
	] as const) {
		for (const variant of [
			{ name: 'plain', color: null },
			{ name: 'cursed_tape@80', color: grade },
		] as const) {
			const outputPath = join(
				workspace,
				`${profile.name}-${variant.name.replaceAll('@', '-')}.mp4`,
			);
			const command = buildRenderCommand(
				plan(variant.color) as never,
				[
					{
						assetId: ASSET_ID,
						path: source,
						durationMs: DURATION_SECONDS * 1_000,
						width: WIDTH,
						height: HEIGHT,
					},
				],
				outputPath,
				{ width: profile.width, height: profile.height, vhsIntensity: 0, threads: 2 },
			);
			const args = ['-y', '-benchmark', ...command.args.slice(1)].map((argument) =>
				argument === 'error' ? 'info' : argument,
			);
			const startedAt = process.hrtime.bigint();
			const result = spawnSync(ffmpegBinary, args, {
				encoding: 'utf8',
				timeout: 600_000,
				windowsHide: true,
				maxBuffer: 16 * 1024 * 1024,
			});
			const wallSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
			if (result.status !== 0) {
				console.error(result.stderr?.slice(-2_000));
				throw new Error(`FFmpeg falhou no perfil ${profile.name}/${variant.name}.`);
			}
			const benchmark = parseBenchmark(result.stderr ?? '');
			results.push({
				profile: profile.name,
				variant: variant.name,
				footageSeconds: DURATION_SECONDS,
				wallSeconds: Number(wallSeconds.toFixed(2)),
				secondsPerFootageMinute: Number(((wallSeconds / DURATION_SECONDS) * 60).toFixed(2)),
				...benchmark,
			});
		}
	}
	console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
} finally {
	await rm(workspace, { recursive: true, force: true });
}
