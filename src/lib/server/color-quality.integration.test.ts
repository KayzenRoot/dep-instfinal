import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compareColorRange, assessColorRange } from '#lib/domain/color-quality.js';
import { measureColorStats } from './color-quality.js';
import { renderPlanToFile } from './render-compose.js';
import type { ColorPresetId } from '#lib/schemas/color-grade.js';

function hasFfmpeg(): boolean {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function createFixture(directory: string, name: string, luma: string | null): string {
	const path = join(directory, `${name}.mp4`);
	const source =
		luma === null
			? 'testsrc2=s=180x320:r=30:d=3'
			: `nullsrc=s=180x320:r=30:d=3,geq=lum='${luma}':cb=128:cr=128,format=yuv420p`;
	execFileSync(
		'ffmpeg',
		[
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
			path,
		],
		{ timeout: 60_000, windowsHide: true },
	);
	return path;
}

function planFor(assetId: string, grade: { presetId: ColorPresetId; strength: number }) {
	return {
		schemaVersion: 1 as const,
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 1,
		durationMs: 3_000,
		sceneDurationMs: 4_000 as const,
		fps: 30 as const,
		tracks: [{ id: 'video-main', kind: 'video' as const, label: 'Vídeo principal' }],
		clips: [
			{
				id: '33333333-3333-4333-8333-333333333333',
				sceneId: '44444444-4444-4444-8444-444444444444',
				assetId,
				trackId: 'video-main',
				sourceInMs: 0,
				sourceOutMs: 3_000,
				timelineStartMs: 0,
				timelineEndMs: 3_000,
				transition: 'cut' as const,
				transitionMs: 0,
				gainDb: 0,
			},
		],
		captions: { template: 'clean' as const },
		cta: null,
		color: {
			presetId: grade.presetId,
			presetVersion: 1 as const,
			strength: grade.strength,
			referenceClipId: null,
			overrides: [],
		},
	};
}

const enabled = hasFfmpeg();
let workspace: string | null = null;

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!enabled)('graded render color range', () => {
	it('preserves shadow detail and avoids clipping on SDR fixtures', async () => {
		workspace = await mkdtemp(join(tmpdir(), 'dif-color-fixtures-'));
		const fixtures = [
			{ name: 'low_light', luma: '20+60*X/W' },
			{ name: 'backlight', luma: '150+80*X/W' },
			{ name: 'ramp', luma: '20+210*X/W' },
			{ name: 'extreme_rgb', luma: null },
		];
		const presetChecks: Array<{ presetId: ColorPresetId; fixture: string }> = fixtures.map(
			(fixture) => ({ presetId: 'cursed_tape', fixture: fixture.name }),
		);
		presetChecks.push(
			{ presetId: 'vhs_1987', fixture: 'low_light' },
			{ presetId: 'police_archive', fixture: 'low_light' },
			{ presetId: 'cctv', fixture: 'low_light' },
		);
		for (const fixture of fixtures) createFixture(workspace, fixture.name, fixture.luma);
		const assetId = '22222222-2222-4222-8222-222222222222';
		for (const [index, check] of presetChecks.entries()) {
			const sourcePath = join(workspace, `${check.fixture}.mp4`);
			const before = await measureColorStats(sourcePath, { fps: 2, frames: 3 });
			const plan = planFor(assetId, { presetId: check.presetId, strength: 100 });
			const output = await renderPlanToFile({
				plan: plan as never,
				assets: [
					{
						assetId,
						path: sourcePath,
						durationMs: 3_000,
						width: 180,
						height: 320,
					},
				],
				outputPath: join(workspace, `graded-${index}.mp4`),
				vhsIntensity: 0,
				width: 720,
				height: 1280,
				timeoutMs: 120_000,
			});
			const after = await measureColorStats(output.path, { fps: 2, frames: 3 });
			const comparison = compareColorRange(before, after);
			const assessment = assessColorRange(after);
			const changed =
				Math.abs(after.meanLuma - before.meanLuma) >= 1 ||
				Math.abs(after.meanSaturation - before.meanSaturation) >= 1;
			console.log(
				`${check.fixture}/${check.presetId}: p05 ${before.p05Luma}→${after.p05Luma}, ` +
					`low ${before.lowClipPct.toFixed(1)}%→${after.lowClipPct.toFixed(1)}%, ` +
					`high ${before.highClipPct.toFixed(1)}%→${after.highClipPct.toFixed(1)}%, ` +
					`luma ${before.meanLuma.toFixed(1)}→${after.meanLuma.toFixed(1)}`,
			);
			expect(changed, `${check.fixture}/${check.presetId} did not apply the grade`).toBe(true);
			expect(comparison.shadowCrush, `${check.fixture}/${check.presetId} crushed shadows`).toBe(
				false,
			);
			expect(
				comparison.highlightCrush,
				`${check.fixture}/${check.presetId} crushed highlights`,
			).toBe(false);
			expect(
				comparison.lowClipGrowth,
				`${check.fixture}/${check.presetId} grew low clipping`,
			).toBeLessThanOrEqual(5);
			expect(
				comparison.highClipGrowth,
				`${check.fixture}/${check.presetId} grew high clipping`,
			).toBeLessThanOrEqual(5);
			expect(assessment.status, `${check.fixture}/${check.presetId} severe clipping`).toBe('PASS');
		}
	}, 300_000);
});
