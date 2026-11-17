import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPlanToFile } from '../src/lib/server/render-compose.js';
import type { AudioMixEvent } from '../src/lib/domain/render-composition.js';
import type { EditDirectorPlan } from '../src/lib/schemas/edit-director.js';
import type { VideoEditPlan } from '../src/lib/schemas/video-edit-plan.js';

const root = join(process.cwd(), 'docs', 'evidence', 'wo-010', 'review');
const voiceSource = join(process.cwd(), 'docs', 'evidence', 'wo-007', 'sample-tension.wav');
const episodeId = '11111111-1111-4111-8111-111111111111';
const assetIds = [1, 2, 3].map(
	(index) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
);
const scenes = [1, 2, 3].map((index) => ({
	id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
	sceneIndex: index,
	startMs: (index - 1) * 4_000,
	endMs: index * 4_000,
}));
const clips = scenes.map((scene, index) => ({
	id: scene.id,
	sceneId: scene.id,
	assetId: assetIds[index]!,
	trackId: 'video-main',
	sourceInMs: 0,
	sourceOutMs: 4_000,
	timelineStartMs: index * 4_000,
	timelineEndMs: index * 4_000 + 4_000,
	transition: 'cut' as const,
	transitionMs: 0,
	gainDb: 0,
}));

async function main(): Promise<void> {
	await mkdir(root, { recursive: true });
	const work = await mkdtemp(join(tmpdir(), 'wo010-review-'));
	try {
		const fixture = join(work, 'scene.mp4');
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
				'testsrc2=size=180x320:rate=30:duration=8',
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-pix_fmt',
				'yuv420p',
				fixture,
			],
			{ stdio: 'ignore' },
		);
		const music = join(work, 'music.wav');
		const impact = join(work, 'impact.wav');
		const voice = join(work, 'voice.wav');
		execFileSync(
			'ffmpeg',
			[
				'-y',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'sine=frequency=90:sample_rate=48000:duration=12',
				'-ac',
				'2',
				music,
			],
			{ stdio: 'ignore' },
		);
		execFileSync(
			'ffmpeg',
			[
				'-y',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'sine=frequency=900:sample_rate=48000:duration=1',
				'-af',
				'afade=t=in:d=0.05,afade=t=out:st=0.7:d=0.3',
				impact,
			],
			{ stdio: 'ignore' },
		);
		execFileSync(
			'ffmpeg',
			['-y', '-loglevel', 'error', '-i', voiceSource, '-t', '8', '-ar', '48000', '-ac', '2', voice],
			{
				stdio: 'ignore',
			},
		);

		for (const [preset, glitchMs, sfxCount] of [
			['slow-burn', 300, 0],
			['reveal', 500, 1],
			['found-footage', 700, 2],
		] as const) {
			const glitchId = '99999999-9999-4999-8999-999999999999';
			const silenceId = '88888888-8888-4888-8888-888888888888';
			const director: EditDirectorPlan = {
				schemaVersion: 1,
				episodeId,
				source: 'OFFLINE',
				preset,
				seed: 7,
				reviewStatus: 'APPLIED',
				generatedAt: '2026-11-17T00:00:00.000Z',
				points: [
					{ timeMs: 0, tension: 12 },
					{ timeMs: 3_000, tension: 35 },
					{ timeMs: 5_500, tension: 55 },
					{ timeMs: 8_000, tension: 95 },
					{ timeMs: 12_000, tension: 75 },
				],
				markers: [
					{ timeMs: 0, phase: 'HOOK', label: 'Hook', rationale: 'Abre a pergunta.' },
					{ timeMs: 8_000, phase: 'REVEAL', label: 'Revelação', rationale: 'Virada.' },
				],
				events: [
					{
						id: silenceId,
						type: 'SILENCE_BEFORE_REVEAL',
						startMs: 6_000,
						durationMs: 1_200,
						intensity: 5,
						reason: 'Pausa a ambiência antes da revelação.',
						assetId: null,
						cueId: null,
						status: 'ACCEPTED',
					},
					{
						id: glitchId,
						type: 'VHS_STATIC',
						startMs: 7_800,
						durationMs: glitchMs,
						intensity: 4,
						reason: `Glitch do preset ${preset}.`,
						assetId: null,
						cueId: null,
						status: 'ACCEPTED',
					},
				],
				cta: null,
				previousCta: null,
				acceptedEventIds: [silenceId, glitchId],
				planHash: null,
				note: '',
			};
			const plan: VideoEditPlan = {
				schemaVersion: 1,
				episodeId,
				episodeRevisionNumber: 1,
				durationMs: 12_000,
				sceneDurationMs: 4_000,
				fps: 30,
				tracks: [{ id: 'video-main', kind: 'video', label: 'Vídeo principal' }],
				clips,
				captions: { template: 'clean' },
				cta: null,
				audio: { masterGainDb: 0, events: [] },
				director,
			};
			const audioEvents: AudioMixEvent[] = [
				{
					id: 'music',
					path: music,
					kind: 'MUSIC',
					startMs: 0,
					durationMs: 12_000,
					sourceInMs: 0,
					gainDb: -20,
					fadeInMs: 250,
					fadeOutMs: 500,
					pan: 0,
					distance: 0.2,
					loop: true,
					ducking: false,
					spatialPreset: 'none',
					spatialMode: 'stereo_pan',
					intensity: 2,
				},
				...Array.from({ length: sfxCount }, (_, index) => ({
					id: `impact-${index}`,
					path: impact,
					kind: 'SFX' as const,
					startMs: 7_600 + index * 250,
					durationMs: 800,
					sourceInMs: 0,
					gainDb: -10,
					fadeInMs: 50,
					fadeOutMs: 80,
					pan: 0,
					distance: 0.2,
					loop: false,
					ducking: false,
					spatialPreset: 'none' as const,
					spatialMode: 'stereo_pan' as const,
					intensity: 4,
				})),
			];
			const outputPath = join(root, `${preset}.mp4`);
			await renderPlanToFile({
				plan,
				assets: assetIds.map((assetId) => ({
					assetId,
					path: fixture,
					durationMs: 8_000,
					width: 180,
					height: 320,
				})),
				outputPath,
				vhsIntensity: 0,
				timeoutMs: 180_000,
				narration: { path: voice, durationMs: 8_000, takeId: 'review' },
				audioEvents,
				masterGainDb: 0,
			});
			console.log('rendered', preset, outputPath);
		}
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
