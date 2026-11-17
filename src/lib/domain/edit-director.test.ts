import { describe, expect, it } from 'vitest';
import { buildDefaultEditPlan } from './video-edit-plan.js';
import {
	applyDirectorToPlan,
	buildDirectorPlan,
	directorAmbientGain,
	directorEventDuration,
	directorEventIntensity,
	directorPlanHash,
	EditDirectorError,
	resetDirector,
	tensionAt,
	type DirectorInput,
} from './edit-director.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';
import { editDirectorPlanSchema } from '#lib/schemas/edit-director.js';
import type { AudioAsset } from '#lib/schemas/audio-library.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const scenes = Array.from({ length: 15 }, (_, index) => ({
	id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
	sceneIndex: index + 1,
	startMs: index * 8_000,
	endMs: (index + 1) * 8_000,
	narration:
		index === 10
			? 'Alice abriu a porta e descobriu a verdade.'
			: `Cena ${index + 1}: a fita continua girando no porão.`,
	visualDescription: `Corredor ${index + 1}`,
	audioNotes: '',
}));
const assets = scenes.map((scene) => ({
	id: `33333333-3333-4333-8333-${String(scene.sceneIndex).padStart(12, '0')}`,
	sceneId: scene.id,
	assetVersion: 1,
	durationMs: 8_000,
}));

function audioAsset(
	overrides: Partial<AudioAsset> & Pick<AudioAsset, 'id' | 'kind' | 'tags'>,
): AudioAsset {
	return {
		title: 'Fixture',
		author: 'DIF',
		source: 'fixture',
		licenseName: 'CC0',
		licenseUrl: null,
		attribution: 'DIF CC0',
		commercialAllowed: true,
		socialAllowed: true,
		licenseStatus: 'VERIFIED',
		intensity: 4,
		sha256: 'a'.repeat(64),
		byteSize: 1024,
		durationMs: 2_000,
		format: 'wav',
		sampleRate: 48_000,
		channels: 1,
		peakDb: -2,
		truePeakDb: -1,
		lufs: -18,
		createdAt: '2026-11-17T00:00:00.000Z',
		...overrides,
	};
}

const door = audioAsset({
	id: '44444444-4444-4444-8444-444444444444',
	kind: 'SFX',
	tags: ['porta'],
});
const impact = audioAsset({
	id: '55555555-5555-4555-8555-555555555555',
	kind: 'SFX',
	tags: ['impacto'],
});
const input: DirectorInput = {
	episodeId,
	durationMs: 120_000,
	seed: 42,
	preset: 'reveal',
	suspense: true,
	scenes,
	characters: ['Alice'],
	location: 'Porão',
	audioAssets: [door, impact],
	choices: [
		{ optionKey: '1', label: 'Abrir a caixa' },
		{ optionKey: '2', label: 'Fechar a porta' },
	],
};

const plan = buildDefaultEditPlan({
	episodeId,
	episodeRevisionNumber: 1,
	durationMs: 120_000,
	sceneDurationMs: 8_000,
	scenes,
	assets,
});

describe('deterministic edit director', () => {
	it('is reproducible for the same input/seed and varies with the seed', () => {
		const first = buildDirectorPlan(input);
		const second = buildDirectorPlan(input);
		expect(directorPlanHash(first)).toBe(directorPlanHash(second));
		expect(first.points).toEqual(second.points);
		expect(first.markers.map((marker) => marker.phase)).toEqual(
			second.markers.map((marker) => marker.phase),
		);
		const other = buildDirectorPlan({ ...input, seed: 43 });
		expect(directorPlanHash(other)).not.toBe(directorPlanHash(first));
	});

	it('emits at least four tension phases and allowlisted events for 120s', () => {
		const director = buildDirectorPlan(input);
		expect(new Set(director.markers.map((marker) => marker.phase)).size).toBeGreaterThanOrEqual(4);
		expect(director.points.length).toBeGreaterThanOrEqual(4);
		expect(director.events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				'SILENCE_BEFORE_REVEAL',
				'DOOR_CREAK',
				'SFX_ACCENT',
				'VHS_STATIC',
				'CTA_CARD',
			]),
		);
		expect(director.events.every((event) => event.startMs + event.durationMs <= 120_000)).toBe(
			true,
		);
		expect(director.cta?.references).toEqual(['Abrir a caixa', 'Fechar a porta']);
	});

	it('keeps four phases for every preset and makes slow-burn lighter than reveal', () => {
		const slow = buildDirectorPlan({ ...input, preset: 'slow-burn' });
		const reveal = buildDirectorPlan({ ...input, preset: 'reveal' });
		const foundFootage = buildDirectorPlan({ ...input, preset: 'found-footage' });
		for (const director of [slow, reveal, foundFootage]) {
			expect(new Set(director.markers.map((marker) => marker.phase)).size).toBeGreaterThanOrEqual(
				4,
			);
		}
		expect(slow.events.length).toBeLessThan(reveal.events.length);
	});

	it('rejects non-monotonic points and overlong photosensitive glitches', () => {
		const director = buildDirectorPlan(input);
		expect(
			editDirectorPlanSchema.safeParse({
				...director,
				points: [
					{ timeMs: 2_000, tension: 10 },
					{ timeMs: 1_000, tension: 20 },
				],
			}).success,
		).toBe(false);
		const vhs = director.events.find((event) => event.type === 'VHS_STATIC')!;
		expect(
			editDirectorPlanSchema.safeParse({
				...director,
				events: director.events.map((event) =>
					event.id === vhs.id ? { ...event, durationMs: 701 } : event,
				),
			}).success,
		).toBe(false);
	});

	it('interpolates the curve and keeps every seed/preset inside safe envelopes', () => {
		const director = buildDirectorPlan(input);
		const midpoint = Math.round((director.points[0]!.timeMs + director.points[1]!.timeMs) / 2);
		const interpolated = tensionAt(director.points, midpoint);
		expect(interpolated).toBeGreaterThanOrEqual(director.points[0]!.tension);
		expect(interpolated).toBeLessThanOrEqual(director.points[1]!.tension);
		expect(tensionAt(director.points, -1)).toBe(director.points[0]!.tension);
		expect(tensionAt(director.points, 999_999)).toBe(director.points.at(-1)!.tension);

		for (const preset of ['slow-burn', 'reveal', 'found-footage'] as const) {
			for (let seed = 0; seed < 12; seed += 1) {
				const candidate = buildDirectorPlan({ ...input, preset, seed });
				expect(candidate.points.every((point) => point.timeMs <= 120_000)).toBe(true);
				expect(candidate.events.every((event) => event.startMs + event.durationMs <= 120_000)).toBe(
					true,
				);
				const vhs = candidate.events.filter((event) => event.type === 'VHS_STATIC');
				expect(vhs.every((event) => event.durationMs <= 700)).toBe(true);
				expect(vhs.reduce((total, event) => total + event.durationMs, 0)).toBeLessThanOrEqual(
					2_100,
				);
			}
		}
	});

	it('falls back cleanly when audio assets are missing', () => {
		const director = buildDirectorPlan({ ...input, audioAssets: [] });
		expect(director.events.some((event) => event.type === 'DOOR_CREAK')).toBe(false);
		expect(director.events.some((event) => event.type === 'SFX_ACCENT')).toBe(false);
		expect(director.events.some((event) => event.type === 'SILENCE_BEFORE_REVEAL')).toBe(true);
		expect(director.events.some((event) => event.type === 'CTA_CARD')).toBe(true);
	});

	it('applies only accepted events to audio/CTA and reverts only the director layer', () => {
		const director = buildDirectorPlan(input);
		const accepted = director.events
			.filter((event) => ['DOOR_CREAK', 'SFX_ACCENT', 'CTA_CARD'].includes(event.type))
			.map((event) => event.id);
		const applied = applyDirectorToPlan({
			plan,
			director,
			assets: [door, impact],
			acceptedEventIds: accepted,
		});
		expect(applied.director?.acceptedEventIds).toEqual(accepted);
		const directorAudio = applied.audio?.events.filter((event) => event.directorEventId) ?? [];
		const expectedIds = director.events
			.filter((event) => accepted.includes(event.id) && event.assetId)
			.map((event) => event.id);
		expect(directorAudio.map((event) => event.id)).toEqual(expectedIds);
		expect(applied.cta?.enabled).toBe(true);
		expect(applied.cta?.text).toContain('Abrir a caixa');
		expect(applied.clips).toEqual(plan.clips);
		const reset = resetDirector(applied);
		expect(reset.director).toBeUndefined();
		expect(reset.audio?.events.some((event) => event.directorEventId)).toBe(false);
		expect(reset.clips).toEqual(plan.clips);
		expect(reset.captions).toEqual(plan.captions);
		expect(reset.cta).toEqual(plan.cta);
	});

	it('is idempotent on re-apply and restores the previous CTA on revert', () => {
		const previousCta = {
			enabled: true,
			text: 'CTA original',
			startMs: 112_000,
			endMs: 118_000,
		};
		const planWithCta = { ...plan, cta: previousCta };
		const director = buildDirectorPlan(input);
		const accepted = director.events
			.filter((event) => ['DOOR_CREAK', 'CTA_CARD'].includes(event.type))
			.map((event) => event.id);
		const once = applyDirectorToPlan({
			plan: planWithCta,
			director,
			assets: [door, impact],
			acceptedEventIds: accepted,
		});
		const twice = applyDirectorToPlan({
			plan: { ...once, director: once.director },
			director: once.director!,
			assets: [door, impact],
			acceptedEventIds: accepted,
		});
		expect(
			twice.audio?.events.filter((event) => event.directorEventId).map((event) => event.id),
		).toEqual(once.audio?.events.filter((event) => event.directorEventId).map((event) => event.id));
		expect(twice.director?.previousCta).toEqual(previousCta);
		expect(resetDirector(twice).cta).toEqual(previousCta);
	});

	it('refuses accepted SFX whose asset vanished or lost its licence', () => {
		const director = buildDirectorPlan(input);
		const accepted = director.events
			.filter((event) => event.type === 'DOOR_CREAK')
			.map((event) => event.id);
		expect(() =>
			applyDirectorToPlan({ plan, director, assets: [impact], acceptedEventIds: accepted }),
		).toThrow(EditDirectorError);
		expect(() =>
			applyDirectorToPlan({
				plan,
				director,
				assets: [{ ...door, licenseStatus: 'BLOCKED' }],
				acceptedEventIds: accepted,
			}),
		).toThrow(EditDirectorError);
		expect(() =>
			applyDirectorToPlan({
				plan,
				director,
				assets: [{ ...door, kind: 'MUSIC' }],
				acceptedEventIds: accepted,
			}),
		).toThrow(EditDirectorError);
	});

	it('scales fades for short SFX so a 100 ms asset still applies', () => {
		const director = buildDirectorPlan(input);
		const accepted = director.events
			.filter((event) => event.type === 'DOOR_CREAK')
			.map((event) => event.id);
		const applied = applyDirectorToPlan({
			plan,
			director,
			assets: [{ ...door, durationMs: 120 }],
			acceptedEventIds: accepted,
		});
		const audio = applied.audio!.events.find((event) => event.directorEventId)!;
		expect(audio.durationMs).toBe(120);
		expect(audio.fadeInMs + audio.fadeOutMs).toBeLessThanOrEqual(audio.durationMs);
	});

	it('maps curve intensity onto gain and VHS duration without moving timecodes', () => {
		const director = buildDirectorPlan(input);
		const vhs = director.events.find((event) => event.type === 'VHS_STATIC')!;
		const doorEvent = director.events.find((event) => event.type === 'DOOR_CREAK')!;
		const low = {
			...director,
			points: director.points.map((point) => ({ ...point, tension: 0 })),
		};
		const high = {
			...director,
			points: director.points.map((point) => ({ ...point, tension: 100 })),
		};
		expect(directorEventDuration(high, vhs)).toBeGreaterThan(directorEventDuration(low, vhs));
		expect(directorEventIntensity(high, doorEvent)).toBeGreaterThan(
			directorEventIntensity(low, doorEvent),
		);
		const lowApplied = applyDirectorToPlan({
			plan,
			director: low,
			assets: [door, impact],
			acceptedEventIds: [doorEvent.id],
		});
		const highApplied = applyDirectorToPlan({
			plan,
			director: high,
			assets: [door, impact],
			acceptedEventIds: [doorEvent.id],
		});
		const lowAudio = lowApplied.audio!.events.find(
			(event) => event.directorEventId === doorEvent.id,
		)!;
		const highAudio = highApplied.audio!.events.find(
			(event) => event.directorEventId === doorEvent.id,
		)!;
		expect(highAudio.gainDb).toBeGreaterThan(lowAudio.gainDb);
		expect(highAudio.startMs).toBe(lowAudio.startMs);
		expect(highAudio.startMs).toBe(doorEvent.startMs);
		expect(directorAmbientGain(low, 0)).toBe(-3);
		expect(directorAmbientGain(high, 0)).toBe(3);
	});

	it('applies curve-driven ambient gain to existing music and removes it on revert', () => {
		const planWithMusic = videoEditPlanSchema.parse({
			...plan,
			audio: {
				masterGainDb: 0,
				events: [
					{
						id: '66666666-6666-4666-8666-666666666666',
						assetId: impact.id,
						kind: 'MUSIC',
						startMs: 0,
						durationMs: 120_000,
						gainDb: -18,
					},
				],
			},
		});
		const director = buildDirectorPlan(input);
		const applied = applyDirectorToPlan({
			plan: planWithMusic,
			director,
			assets: [door, impact],
			acceptedEventIds: [],
		});
		const music = applied.audio!.events.find((event) => event.kind === 'MUSIC')!;
		expect(music.directorGainDb).not.toBe(0);
		const reset = resetDirector(applied);
		expect(
			reset.audio!.events.find((event) => event.kind === 'MUSIC')?.directorGainDb,
		).toBeUndefined();
	});
});
