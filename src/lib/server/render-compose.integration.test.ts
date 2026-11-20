import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildSceneTimeline } from '#lib/domain/timeline.js';
import { buildDefaultEditPlan } from '#lib/domain/video-edit-plan.js';
import { buildRenderCommand } from '#lib/domain/render-composition.js';
import { renderPlanToFile } from './render-compose.js';
import { buildCaptionAss } from '#lib/domain/captions.js';
import { buildEndCardAss, buildEndCardSfxWav } from '#lib/domain/choice-end-card.js';
import type { AudioMixEvent } from '#lib/domain/render-composition.js';
import { captionTrackSchema } from '#lib/schemas/captions.js';

function hasFfmpeg(): boolean {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function createSyntheticClip(
	directory: string,
	assetId: string,
	seconds: number,
	source = 'testsrc2=size=180x320:rate=30',
): string {
	const path = join(directory, `${assetId}.mp4`);
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
			`${source}:duration=${seconds}`,
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

function mixEvent(overrides: Partial<AudioMixEvent> & Pick<AudioMixEvent, 'id' | 'path'>) {
	const event: AudioMixEvent = {
		kind: 'SFX',
		startMs: 0,
		durationMs: 4_000,
		sourceInMs: 0,
		gainDb: 0,
		fadeInMs: 0,
		fadeOutMs: 0,
		pan: 0,
		distance: 0.5,
		loop: false,
		ducking: false,
		spatialPreset: 'none',
		spatialMode: 'stereo_pan',
		intensity: 1,
		...overrides,
	};
	return event;
}

function twoClipPlan(workspace: string, source = 'testsrc2=size=180x320:rate=30') {
	const scenes = [1, 2].map((index) => ({
		id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		sceneIndex: index,
		startMs: (index - 1) * 2_000,
		endMs: index * 2_000,
	}));
	const assets = [];
	for (const scene of scenes) {
		const assetId = `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`;
		createSyntheticClip(workspace, assetId, 2, source);
		assets.push({ id: assetId, sceneId: scene.id, assetVersion: 1, durationMs: 2_000 });
	}
	const plan = {
		schemaVersion: 1 as const,
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 1,
		durationMs: 4_000,
		sceneDurationMs: 4_000 as const,
		fps: 30 as const,
		tracks: [{ id: 'video-main', kind: 'video' as const, label: 'Vídeo principal' }],
		clips: assets.map((asset, index) => ({
			id: asset.id,
			sceneId: asset.sceneId,
			assetId: asset.id,
			trackId: 'video-main',
			sourceInMs: 0,
			sourceOutMs: 2_000,
			timelineStartMs: index * 2_000,
			timelineEndMs: index * 2_000 + 2_000,
			transition: 'cut' as const,
			transitionMs: 0,
			gainDb: 0,
		})),
		captions: { template: 'clean' as const },
		cta: null,
	};
	const inputs = assets.map((asset) => ({
		assetId: asset.id,
		path: join(workspace, `${asset.id}.mp4`),
		durationMs: 2_000,
		width: 180,
		height: 320,
	}));
	return { plan, inputs };
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
			createSyntheticClip(workspace!, assetId, 8);
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
			timeoutMs: 600_000,
		});
		expect(output.width).toBe(1080);
		expect(output.height).toBe(1920);
		expect(output.codec).toBe('h264');
		expect(Math.abs(output.durationMs - 120_000)).toBeLessThanOrEqual(1_000);
		expect(output.byteSize).toBeGreaterThan(0);
		expect(output.sha256).toMatch(/^[0-9a-f]{64}$/);
	}, 900_000);
});

describe.skipIf(!enabled)('FFmpeg graded render and narration integration', () => {
	it('renders a graded clip with the preset filter', async () => {
		const local = await mkdtemp(join(tmpdir(), 'dif-render-color-'));
		try {
			const { plan, inputs } = twoClipPlan(local);
			const graded = {
				...plan,
				color: {
					presetId: 'cursed_tape' as const,
					presetVersion: 1 as const,
					strength: 80,
					referenceClipId: null,
					overrides: [{ clipId: plan.clips[1]!.id, strength: 80, exclude: true }],
				},
			};
			const output = await renderPlanToFile({
				plan: graded,
				assets: inputs,
				outputPath: join(local, 'graded.mp4'),
				timeoutMs: 60_000,
			});
			expect(output.codec).toBe('h264');
			expect(output.width).toBe(1080);
			expect(output.height).toBe(1920);
			expect(output.fps).toBeGreaterThanOrEqual(29);
			expect(output.fps).toBeLessThanOrEqual(31);
			expect(output.durationMs).toBeGreaterThan(3_500);
			expect(output.audio).toBeNull();
		} finally {
			await rm(local, { recursive: true, force: true });
		}
	}, 120_000);

	it('muxes a shorter narration as padded AAC and reports exact timing', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-narration-mux-'));
		try {
			const { plan, inputs } = twoClipPlan(workspace);
			const narrationPath = join(workspace, 'voice.wav');
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
					'sine=frequency=440:sample_rate=48000:duration=3',
					'-ac',
					'1',
					'-c:a',
					'pcm_s16le',
					narrationPath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const output = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'narrated.mp4'),
				vhsIntensity: 0,
				timeoutMs: 120_000,
				narration: {
					path: narrationPath,
					durationMs: 3_000,
					takeId: '33333333-3333-4333-8333-333333333333',
				},
			});
			expect(output.codec).toBe('h264');
			expect(output.audio).toMatchObject({
				codec: 'aac',
				channels: 2,
				sampleRate: 48_000,
				narrationTakeId: '33333333-3333-4333-8333-333333333333',
				narrationDurationMs: 3_000,
			});
			expect(output.audio!.paddedMs).toBeGreaterThanOrEqual(900);
			expect(Math.abs(output.audio!.durationMs - output.durationMs)).toBeLessThanOrEqual(1_000);
			const loudness = spawnSync(
				'ffmpeg',
				['-hide_banner', '-nostdin', '-i', output.path, '-af', 'volumedetect', '-f', 'null', '-'],
				{ encoding: 'utf8', windowsHide: true },
			);
			const meanVolume = /mean_volume:\s*(-?[0-9.]+) dB/.exec(loudness.stderr);
			expect(meanVolume).not.toBeNull();
			expect(Number(meanVolume![1])).toBeGreaterThan(-60);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);
});

describe.skipIf(!enabled)('FFmpeg caption burn-in integration', () => {
	it('burns ASS from an apostrophe path inside the horizontal safe area', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-caption-burn-'));
		try {
			const captionDir = join(workspace, "cap'test");
			await mkdir(captionDir);
			const { plan, inputs } = twoClipPlan(workspace, 'color=c=black:s=180x320:r=30');
			const track = captionTrackSchema.parse({
				schemaVersion: 1,
				episodeId: plan.episodeId,
				planId: '33333333-3333-4333-8333-333333333333',
				planVersion: 1,
				narrationTakeId: null,
				style: 'clean',
				safeZone: 'tiktok',
				source: 'MANUAL',
				cues: [
					{
						id: '44444444-4444-4444-8444-444444444444',
						startMs: 200,
						endMs: 3_500,
						text: `${'漢'.repeat(27)}\n${'😀'.repeat(20)}`,
						words: [],
					},
				],
			});
			const assPath = join(captionDir, 'captions.ass');
			await writeFile(assPath, buildCaptionAss(track), 'utf8');
			const output = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'captioned.mp4'),
				vhsIntensity: 0,
				timeoutMs: 120_000,
				captionAssPath: assPath,
			});
			expect(output.codec).toBe('h264');
			expect(Math.abs(output.durationMs - 4_000)).toBeLessThanOrEqual(1_000);
			const framePath = join(workspace, 'frame.rgb');
			execFileSync(
				'ffmpeg',
				[
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-ss',
					'1.5',
					'-i',
					output.path,
					'-frames:v',
					'1',
					'-pix_fmt',
					'rgb24',
					'-f',
					'rawvideo',
					framePath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const frame = await readFile(framePath);
			let minX = 1080;
			let maxX = -1;
			let count = 0;
			for (let y = 1_200; y < 1_920; y += 1) {
				for (let x = 0; x < 1_080; x += 1) {
					const offset = (y * 1_080 + x) * 3;
					if (frame[offset]! > 140 && frame[offset + 1]! > 140 && frame[offset + 2]! > 140) {
						minX = Math.min(minX, x);
						maxX = Math.max(maxX, x);
						count += 1;
					}
				}
			}
			expect(count).toBeGreaterThan(500);
			expect(minX).toBeGreaterThanOrEqual(80);
			expect(maxX).toBeLessThanOrEqual(1_000);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);

	it('positions captions inside the selected profile box in the real MP4', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-caption-position-'));
		try {
			const { plan, inputs } = twoClipPlan(workspace, 'color=c=black:s=180x320:r=30');
			const track = captionTrackSchema.parse({
				schemaVersion: 1,
				episodeId: plan.episodeId,
				planId: '33333333-3333-4333-8333-333333333333',
				planVersion: 1,
				narrationTakeId: null,
				style: 'clean',
				safeZone: 'tiktok',
				source: 'MANUAL',
				cues: [
					{
						id: '44444444-4444-4444-8444-444444444444',
						startMs: 200,
						endMs: 3_500,
						text: 'TESTE',
						role: 'CAPTION',
						words: [],
					},
				],
			});
			const assPath = join(workspace, 'positioned.ass');
			await writeFile(
				assPath,
				buildCaptionAss(track, {
					captionBox: { x: 300, y: 600, width: 480, height: 200 },
					ctaBox: { x: 240, y: 1_100, width: 600, height: 200 },
				}),
				'utf8',
			);
			const output = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'positioned.mp4'),
				vhsIntensity: 0,
				timeoutMs: 120_000,
				captionAssPath: assPath,
			});
			const framePath = join(workspace, 'frame.rgb');
			execFileSync(
				'ffmpeg',
				[
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-ss',
					'1.5',
					'-i',
					output.path,
					'-frames:v',
					'1',
					'-pix_fmt',
					'rgb24',
					'-f',
					'rawvideo',
					framePath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const frame = await readFile(framePath);
			let minX = 1_080;
			let maxX = -1;
			let minY = 1_920;
			let maxY = -1;
			let count = 0;
			for (let y = 450; y < 900; y += 1) {
				for (let x = 200; x < 900; x += 1) {
					const offset = (y * 1_080 + x) * 3;
					if (frame[offset]! > 140 && frame[offset + 1]! > 140 && frame[offset + 2]! > 140) {
						minX = Math.min(minX, x);
						maxX = Math.max(maxX, x);
						minY = Math.min(minY, y);
						maxY = Math.max(maxY, y);
						count += 1;
					}
				}
			}
			expect(count).toBeGreaterThan(100);
			expect(minX).toBeGreaterThanOrEqual(250);
			expect(maxX).toBeLessThanOrEqual(830);
			expect(minY).toBeGreaterThanOrEqual(560);
			expect(maxY).toBeLessThanOrEqual(840);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);
});

describe.skipIf(!enabled)('FFmpeg end-card burn-in integration', () => {
	it('burns the A/B card and synthesizes its SFX into the final MP4', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-endcard-'));
		try {
			const { plan, inputs } = twoClipPlan(workspace, 'color=c=0x00ff00:s=180x320:r=30');
			const endCard = {
				schemaVersion: 1 as const,
				templateId: 'doors' as const,
				layout: 'split' as const,
				durationMs: 4_000,
				prompt: 'Qual caminho você escolhe?',
				footer: 'Comente A ou B',
				reveal: 'progressive' as const,
				reducedMotion: false,
				sfx: 'beep' as const,
				sfxVolumeDb: -12,
				narration: 'mute' as const,
				cardId: '55555555-5555-4555-8555-555555555555',
				cardRevision: 1,
				choiceRevisionNumber: 1,
				startMs: 0,
				endMs: 4_000,
				choices: [
					{
						id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						optionKey: '1' as const,
						label: 'ENTRAR',
						consequence: 'Entra.',
					},
					{
						id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
						optionKey: '2' as const,
						label: 'FUGIR',
						consequence: 'Foge.',
					},
				],
			};
			const assPath = join(workspace, 'endcard.ass');
			await writeFile(
				assPath,
				buildEndCardAss(endCard, { x: 48, y: 180, width: 984, height: 1_500 }),
				'utf8',
			);
			const sfxPath = join(workspace, 'endcard.wav');
			await writeFile(sfxPath, buildEndCardSfxWav('beep', 4_000, -12)!);
			const output = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'output.mp4'),
				endCardAssPath: assPath,
				audioEvents: [
					mixEvent({
						id: '66666666-6666-4666-8666-666666666666',
						path: sfxPath,
						fadeInMs: 60,
						fadeOutMs: 120,
					}),
				],
				timeoutMs: 180_000,
			});
			expect(output.audio).not.toBeNull();
			expect(output.durationMs).toBeGreaterThanOrEqual(3_900);

			const framePath = join(workspace, 'card.png');
			execFileSync(
				'ffmpeg',
				[
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-ss',
					'2.0',
					'-i',
					output.path,
					'-frames:v',
					'1',
					framePath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const frame = await sharp(framePath)
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let accentPixels = 0;
			let greenPixels = 0;
			let lumaSum = 0;
			for (let index = 0; index < frame.data.length; index += 3) {
				const red = frame.data[index]!;
				const green = frame.data[index + 1]!;
				const blue = frame.data[index + 2]!;
				lumaSum += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				if (red > 150 && green > 90 && blue < 120) accentPixels += 1;
				if (green > 180 && red < 80 && blue < 80) greenPixels += 1;
			}
			const pixels = frame.info.width * frame.info.height;
			expect(lumaSum / pixels).toBeLessThan(100);
			expect(greenPixels).toBeLessThan(500);
			expect(accentPixels).toBeGreaterThan(1_000);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);
});

describe.skipIf(!enabled)('FFmpeg end-card narration gate', () => {
	it('mutes narration inside the card even without SFX events', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-endcard-mute-'));
		try {
			const { plan, inputs } = twoClipPlan(workspace);
			const narrationPath = join(workspace, 'voice.wav');
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
					'sine=frequency=440:sample_rate=48000:duration=4',
					'-af',
					'volume=0.2,pan=stereo|c0=c0|c1=c0',
					'-c:a',
					'pcm_s16le',
					narrationPath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const output = await renderPlanToFile({
				plan: {
					...plan,
					endCard: {
						schemaVersion: 1,
						templateId: 'doors',
						layout: 'stacked',
						durationMs: 3_000,
						prompt: 'Qual caminho?',
						footer: 'Comente A ou B',
						reveal: 'instant',
						reducedMotion: true,
						sfx: 'none',
						sfxVolumeDb: -12,
						narration: 'mute',
						cardId: '55555555-5555-4555-8555-555555555555',
						cardRevision: 1,
						choiceRevisionNumber: 1,
						startMs: 1_000,
						endMs: 4_000,
						choices: [
							{
								id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
								optionKey: '1' as const,
								label: 'ENTRAR',
								consequence: 'Entra.',
							},
							{
								id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
								optionKey: '2' as const,
								label: 'FUGIR',
								consequence: 'Foge.',
							},
						],
					},
				},
				assets: inputs,
				outputPath: join(workspace, 'output.mp4'),
				narration: { path: narrationPath, durationMs: 4_000, takeId: 'narr-1' },
				timeoutMs: 120_000,
			});
			const levelAt = (seconds: number) => {
				const result = spawnSync(
					'ffmpeg',
					[
						'-hide_banner',
						'-ss',
						String(seconds),
						'-t',
						'0.2',
						'-i',
						output.path,
						'-af',
						'volumedetect',
						'-f',
						'null',
						'-',
					],
					{ encoding: 'utf8', windowsHide: true },
				);
				const match = /max_volume: (-?\d+(?:\.\d+)?) dB/.exec(result.stderr);
				expect(match).toBeTruthy();
				return Number(match?.[1]);
			};
			expect(levelAt(0.4)).toBeGreaterThan(-40);
			expect(levelAt(2.4)).toBeLessThan(-70);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 120_000);
});

describe.skipIf(!enabled)('FFmpeg crossfade integration', () => {
	it('renders a crossfade with matching xfade timebases', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-crossfade-'));
		try {
			const scenes = [1, 2, 3, 4].map((index) => ({
				id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
				sceneIndex: index,
				startMs: (index - 1) * 2_000,
				endMs: index * 2_000,
			}));
			const assets = [];
			for (const scene of scenes) {
				const assetId = `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`;
				createSyntheticClip(workspace!, assetId, 2);
				assets.push({ id: assetId, sceneId: scene.id, assetVersion: 1, durationMs: 2_000 });
			}
			const starts = [0, 1_500, 3_000, 5_000];
			const clips = assets.map((asset, index) => ({
				id: asset.id,
				sceneId: asset.sceneId,
				assetId: asset.id,
				trackId: 'video-main',
				sourceInMs: 0,
				sourceOutMs: 2_000,
				timelineStartMs: starts[index]!,
				timelineEndMs: starts[index]! + 2_000,
				transition: (index === 1 || index === 2 ? 'crossfade' : 'cut') as 'cut' | 'crossfade',
				transitionMs: index === 1 || index === 2 ? 500 : 0,
				gainDb: 0,
			}));
			const plan = {
				schemaVersion: 1 as const,
				episodeId: '11111111-1111-4111-8111-111111111111',
				episodeRevisionNumber: 1,
				durationMs: 90_000,
				sceneDurationMs: 4_000 as const,
				fps: 30 as const,
				tracks: [{ id: 'video-main', kind: 'video' as const, label: 'Vídeo principal' }],
				clips,
				captions: { template: 'clean' as const },
				cta: null,
			};
			const outputPath = join(workspace, 'crossfade.mp4');
			const output = await renderPlanToFile({
				plan,
				assets: assets.map((asset) => ({
					assetId: asset.id,
					path: join(workspace, `${asset.id}.mp4`),
					durationMs: 2_000,
					width: 180,
					height: 320,
				})),
				outputPath,
				vhsIntensity: 1,
				timeoutMs: 120_000,
			});
			expect(output.width).toBe(1080);
			expect(output.height).toBe(1920);
			expect(Math.abs(output.durationMs - 7_000)).toBeLessThanOrEqual(1_000);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);
});

describe.skipIf(!enabled)('FFmpeg audio mix integration', () => {
	it('mixes narration, ducked music and SFX with loudness/true-peak safety', async () => {
		const workspace = await mkdtemp(join(tmpdir(), 'dif-audio-mix-'));
		try {
			const { plan, inputs } = twoClipPlan(workspace);
			const narrationPath = join(workspace, 'narration.wav');
			const musicPath = join(workspace, 'music.wav');
			const sfxPath = join(workspace, 'impact.wav');
			for (const [path, frequency, seconds] of [
				[narrationPath, 300, 3],
				[musicPath, 90, 4],
				[sfxPath, 1_200, 1],
			] as const) {
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
						`sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
						'-ac',
						'1',
						'-c:a',
						'pcm_s16le',
						path,
					],
					{ timeout: 60_000, windowsHide: true },
				);
			}
			const events: AudioMixEvent[] = [
				mixEvent({
					id: 'music',
					path: musicPath,
					kind: 'MUSIC',
					gainDb: -18,
					fadeInMs: 250,
					fadeOutMs: 350,
					pan: -0.3,
					loop: true,
					ducking: true,
					intensity: 3,
				}),
				mixEvent({
					id: 'impact',
					path: sfxPath,
					startMs: 2_000,
					durationMs: 800,
					gainDb: -8,
					fadeInMs: 50,
					fadeOutMs: 80,
					pan: 0.7,
					distance: 0.2,
					spatialPreset: 'steps-behind',
					spatialMode: 'binaural_simulated',
					intensity: 5,
				}),
			];
			const render = (name: string) =>
				renderPlanToFile({
					plan,
					assets: inputs,
					outputPath: join(workspace, name),
					vhsIntensity: 0,
					timeoutMs: 120_000,
					narration: { path: narrationPath, durationMs: 3_000, takeId: 'narration' },
					audioEvents: events,
					masterGainDb: -2,
				});
			const first = await render('mix-a.mp4');
			expect(first.audio).toMatchObject({
				codec: 'aac',
				channels: 2,
				sampleRate: 48_000,
				eventCount: 2,
				duckedCount: 1,
				masterGainDb: -2,
			});
			expect(first.audio!.truePeakDb).not.toBeNull();
			expect(first.audio!.truePeakDb!).toBeLessThanOrEqual(-0.8);
			expect(first.audio!.lufs).not.toBeNull();
			expect(first.audio!.lufs!).toBeGreaterThanOrEqual(-20);
			expect(first.audio!.lufs!).toBeLessThanOrEqual(-12);
			const noDuck = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'mix-noduck.mp4'),
				vhsIntensity: 0,
				timeoutMs: 120_000,
				narration: { path: narrationPath, durationMs: 3_000, takeId: 'narration' },
				audioEvents: events.map((event) =>
					event.kind === 'MUSIC' ? { ...event, ducking: false } : event,
				),
				masterGainDb: -2,
			});
			const bandLevel = (file: string, frequency: number, start = 0.5, length = 2) => {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					const result = spawnSync(
						'ffmpeg',
						[
							'-hide_banner',
							'-nostdin',
							'-ss',
							String(start),
							'-t',
							String(length),
							'-i',
							file,
							'-af',
							`bandpass=f=${frequency}:width_type=h:w=30,volumedetect`,
							'-f',
							'null',
							'-',
						],
						{ encoding: 'utf8', windowsHide: true },
					);
					const match = /mean_volume:\s*(-?[0-9.]+) dB/.exec(result.stderr);
					if (match) return Number(match[1]);
					console.error(
						'band fail',
						file,
						frequency,
						result.status,
						result.error?.message,
						result.stderr.slice(0, 200),
					);
				}
				return null;
			};
			const duckedMusic = bandLevel(first.path, 90);
			const openMusic = bandLevel(noDuck.path, 90);
			const voiceBand = bandLevel(first.path, 300);
			const openVoiceBand = bandLevel(noDuck.path, 300);
			const sfxDuring = bandLevel(first.path, 1_200, 2.05, 0.7);
			const sfxBefore = bandLevel(first.path, 1_200, 0.2, 0.8);
			const channelBand = (file: string, channel: 'c0' | 'c1') => {
				const result = spawnSync(
					'ffmpeg',
					[
						'-hide_banner',
						'-nostdin',
						'-ss',
						'2.05',
						'-t',
						'0.7',
						'-i',
						file,
						'-af',
						`pan=mono|c0=${channel},bandpass=f=1200:width_type=h:w=30,volumedetect`,
						'-f',
						'null',
						'-',
					],
					{ encoding: 'utf8', windowsHide: true },
				);
				const match = /mean_volume:\s*(-?[0-9.]+) dB/.exec(result.stderr);
				return match ? Number(match[1]) : null;
			};
			expect(duckedMusic).not.toBeNull();
			expect(openMusic).not.toBeNull();
			expect(voiceBand).not.toBeNull();
			expect(duckedMusic! - voiceBand!).toBeLessThan(openMusic! - openVoiceBand! - 2);
			expect(voiceBand!).toBeGreaterThan(-45);
			expect(sfxDuring! - sfxBefore!).toBeGreaterThanOrEqual(6);
			expect(channelBand(first.path, 'c1')! - channelBand(first.path, 'c0')!).toBeGreaterThan(2);
			const instrumental = await renderPlanToFile({
				plan,
				assets: inputs,
				outputPath: join(workspace, 'mix-instrumental.mp4'),
				vhsIntensity: 0,
				timeoutMs: 120_000,
				audioEvents: events.map((event) => ({ ...event, ducking: false })),
				masterGainDb: 0,
			});
			expect(instrumental.audio).toMatchObject({
				eventCount: 2,
				narrationTakeId: null,
				channels: 2,
				sampleRate: 48_000,
			});
			const second = await render('mix-b.mp4');
			expect(Math.abs(second.durationMs - first.durationMs)).toBeLessThanOrEqual(50);
			expect(second.audio!.lufs!).toBeCloseTo(first.audio!.lufs!, 0);

			const firstMonoPath = join(workspace, 'mix-a-mono.wav');
			execFileSync(
				'ffmpeg',
				[
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-i',
					first.path,
					'-ac',
					'1',
					'-c:a',
					'pcm_s16le',
					firstMonoPath,
				],
				{ timeout: 60_000, windowsHide: true },
			);
			const mono = spawnSync(
				'ffmpeg',
				[
					'-hide_banner',
					'-nostdin',
					'-i',
					first.path,
					'-ac',
					'1',
					'-af',
					'volumedetect',
					'-f',
					'null',
					'-',
				],
				{ encoding: 'utf8', windowsHide: true },
			);
			const meanVolume = /mean_volume:\s*(-?[0-9.]+) dB/.exec(mono.stderr);
			expect(meanVolume).not.toBeNull();
			expect(Number(meanVolume![1])).toBeGreaterThan(-60);
			const stereoBand = bandLevel(first.path, 90);
			const monoBand = bandLevel(firstMonoPath, 90);
			expect(stereoBand).not.toBeNull();
			expect(monoBand).not.toBeNull();
			expect(Math.abs(stereoBand! - monoBand!)).toBeLessThanOrEqual(3);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 180_000);
});
