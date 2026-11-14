import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = Boolean(
	(process.env.PIPER_BIN || process.env.PIPER_PYTHON) && process.env.PIPER_MODEL,
);
let workspace: string | null = null;

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!enabled)('local Piper TTS integration', () => {
	it('generates segmented pt-BR audio with honest capability metadata', async () => {
		workspace = await mkdtemp(join(tmpdir(), 'dif-tts-'));
		const planPath = join(workspace, 'plan.json');
		const outputDir = join(workspace, 'out');
		await writeFile(
			planPath,
			JSON.stringify({
				schemaVersion: 1,
				episodeId: '11111111-1111-4111-8111-111111111111',
				episodeRevisionNumber: 1,
				takeId: null,
				generatedBy: 'heuristic',
				modelId: null,
				narrationTextSha256: null,
				segments: [
					{
						id: '11111111-aaaa-4aaa-8aaa-111111111111',
						sceneId: null,
						text: 'A fita chegou às três da manhã.',
						emotion: 'neutral',
						speed: 1,
						pauseBeforeMs: 200,
						pauseAfterMs: 300,
						volumeDb: -1,
						intendedWpm: 145,
						pronunciation: '',
					},
					{
						id: '22222222-bbbb-4bbb-8bbb-222222222222',
						sceneId: null,
						text: 'Então Alice ouviu a própria voz sussurrando.',
						emotion: 'whisper',
						speed: 0.9,
						pauseBeforeMs: 300,
						pauseAfterMs: 500,
						volumeDb: -3,
						intendedWpm: 130,
						pronunciation: 'Alice=Álissi',
					},
				],
			}),
		);
		const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
		execFileSync(process.execPath, [tsx, join(process.cwd(), 'scripts', 'narration-tts.ts')], {
			env: {
				...process.env,
				TTS_PLAN_FILE: planPath,
				TTS_OUTPUT_DIR: outputDir,
				PIPER_VOICE: process.env.PIPER_VOICE ?? 'synthetic',
				PIPER_MODEL_LICENSE: process.env.PIPER_MODEL_LICENSE ?? 'synthetic-test',
			},
			stdio: 'ignore',
			timeout: 180_000,
			windowsHide: true,
		});
		const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8')) as {
			totalMs: number;
			clipping: boolean;
			truePeakDb: number | null;
			segments: Array<{ startMs: number; endMs: number }>;
			capability: { emotion: boolean; speed: boolean; pause: boolean };
			modelSha256: string;
		};
		expect(report.totalMs).toBeGreaterThan(1_000);
		expect(report.segments).toHaveLength(2);
		expect(report.segments[1]!.startMs).toBe(report.segments[0]!.endMs);
		expect(report.clipping).toBe(false);
		expect(report.truePeakDb === null || report.truePeakDb <= -0.5).toBe(true);
		expect(report.capability).toEqual({
			emotion: false,
			speed: true,
			pause: true,
			volume: true,
			pronunciationMap: true,
		});
		expect(report.modelSha256).toMatch(/^[0-9a-f]{64}$/);
	}, 240_000);
});
