import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSceneTimeline } from '#lib/domain/timeline.js';
import { buildDefaultEditPlan } from '#lib/domain/video-edit-plan.js';
import { buildRenderCommand } from '#lib/domain/render-composition.js';
import { renderPlanToFile } from './render-compose.js';

function hasFfmpeg(): boolean {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

const enabled = hasFfmpeg();
let workspace: string | null = null;

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!enabled)('FFmpeg composition integration', () => {
	it('renders a 120s 9:16 H.264 episode from 15 synthetic clips', async () => {
		workspace = await mkdtemp(join(tmpdir(), 'dif-render-'));
		const scenes = buildSceneTimeline(120_000, 8_000).map((scene) => ({
			id: `00000000-0000-4000-8000-${String(scene.index).padStart(12, '0')}`,
			sceneIndex: scene.index,
			startMs: scene.startMs,
			endMs: scene.endMs,
		}));
		const assets = [];
		for (const scene of scenes) {
			const assetId = `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`;
			const path = join(workspace, `${assetId}.mp4`);
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
					`testsrc2=size=180x320:rate=30:duration=8`,
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
			assets.push({ id: assetId, sceneId: scene.id, assetVersion: 1, durationMs: 8_000 });
		}
		const context = {
			episodeId: '11111111-1111-4111-8111-111111111111',
			episodeRevisionNumber: 1,
			durationMs: 120_000,
			sceneDurationMs: 8_000 as const,
			scenes,
			assets,
		};
		const plan = buildDefaultEditPlan(context);
		const command = buildRenderCommand(
			plan,
			assets.map((asset) => ({
				assetId: asset.id,
				path: join(workspace!, `${asset.id}.mp4`),
				durationMs: 8_000,
				width: 180,
				height: 320,
			})),
			join(workspace!, 'episode.mp4'),
			{ vhsIntensity: 1 },
		);
		expect(command.filterGraph).toContain('noise=alls=8');
		const output = await renderPlanToFile({
			plan,
			assets: assets.map((asset) => ({
				assetId: asset.id,
				path: join(workspace!, `${asset.id}.mp4`),
				durationMs: 8_000,
				width: 180,
				height: 320,
			})),
			outputPath: join(workspace!, 'episode.mp4'),
			vhsIntensity: 1,
			timeoutMs: 300_000,
		});
		expect(output.width).toBe(1080);
		expect(output.height).toBe(1920);
		expect(output.codec).toBe('h264');
		expect(Math.abs(output.durationMs - 120_000)).toBeLessThanOrEqual(1_000);
		expect(output.byteSize).toBeGreaterThan(0);
		expect(output.sha256).toMatch(/^[0-9a-f]{64}$/);
	}, 300_000);
});
