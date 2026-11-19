import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultPreview } from '#lib/domain/platform-preview.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import type { RenderOutput } from './render-compose.js';
import { inspectRenderArtifact } from './quality-inspector.js';

function hasFfmpeg(): boolean {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

const scratch = await mkdtemp(join(tmpdir(), 'dif-quality-'));

afterAll(async () => {
	await rm(scratch, { recursive: true, force: true });
});

function plan(durationMs: number): VideoEditPlan {
	return {
		schemaVersion: 1,
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: null,
		durationMs,
		sceneDurationMs: 4_000,
		fps: 30,
		tracks: [{ id: 'video-main', kind: 'video', label: 'Vídeo principal' }],
		clips: [
			{
				id: '22222222-2222-4222-8222-222222222222',
				sceneId: '33333333-3333-4333-8333-333333333333',
				assetId: '44444444-4444-4444-8444-444444444444',
				trackId: 'video-main',
				sourceInMs: 0,
				sourceOutMs: durationMs,
				timelineStartMs: 0,
				timelineEndMs: durationMs,
				transition: 'cut',
				transitionMs: 0,
				gainDb: 0,
			},
		],
		captions: { template: 'none' },
		cta: null,
		audio: { masterGainDb: 0, events: [] },
		preview: defaultPreview(),
	} as VideoEditPlan;
}

async function artifact(name: string, source: string): Promise<RenderOutput> {
	const path = join(scratch, `${name}.mp4`);
	execFileSync('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-f',
		'lavfi',
		'-i',
		source,
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		path,
	]);
	const bytes = await readFile(path);
	return {
		path,
		durationMs: 3_000,
		width: 720,
		height: 1280,
		fps: 30,
		pixelFormat: 'yuv420p',
		codec: 'h264',
		container: 'mp4',
		byteSize: (await stat(path)).size,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		audio: null,
	};
}

function inspect(output: RenderOutput, editPlan: VideoEditPlan, suffix: number) {
	return inspectRenderArtifact({
		jobId: `55555555-5555-4555-8555-55555555555${suffix}`,
		episodeId: '11111111-1111-4111-8111-111111111111',
		planId: `66666666-6666-4666-8666-66666666666${suffix}`,
		planVersion: 1,
		planSha256: 'a'.repeat(64),
		plan: editPlan,
		output,
		captionTrack: null,
		narrationExpected: false,
		hasAudioExpected: false,
		outputProfile: '720p',
		quality: 'standard',
	});
}

const color = {
	presetId: 'cursed_tape' as const,
	presetVersion: 1 as const,
	strength: 80,
	referenceClipId: null,
	overrides: [],
};

describe.skipIf(!hasFfmpeg())('quality inspector integration', () => {
	it('flags an unplanned black segment in a real H.264 artifact', async () => {
		const result = await inspect(
			await artifact('black', 'color=c=black:s=720x1280:r=30:d=3'),
			plan(3_000),
			5,
		);
		expect(result.status).toBe('WARN');
		const black = result.report.checks.find((check) => check.id === 'BLACK_FRAMES');
		expect(black?.status).toBe('WARN');
		expect(black?.evidence[0]).toMatchObject({ startMs: 0 });
		expect(result.report.checks.find((check) => check.id === 'DECODE')?.status).toBe('PASS');
		expect(result.report.checks.find((check) => check.id === 'CONTAINER')?.status).toBe('PASS');
	}, 60_000);

	it('reports the tonal range for a plan with Color Match', async () => {
		const result = await inspect(
			await artifact('graded', 'testsrc2=s=720x1280:r=30:d=3'),
			{ ...plan(3_000), color },
			6,
		);
		const range = result.report.checks.find((check) => check.id === 'COLOR_RANGE');
		expect(range?.status).toBe('PASS');
		expect(range?.evidence.length).toBeGreaterThanOrEqual(2);
	}, 60_000);

	it('warns when a Color Match plan clips most of the frame', async () => {
		const result = await inspect(
			await artifact('clipped', 'color=c=black:s=720x1280:r=30:d=3'),
			{ ...plan(3_000), color },
			7,
		);
		expect(result.report.checks.find((check) => check.id === 'COLOR_RANGE')?.status).toBe('WARN');
	}, 60_000);
});
