import { describe, expect, it } from 'vitest';
import { characterIdentityProfileSchema } from '#lib/schemas/character-identity.js';
import { visualContinuityReportSchema } from '#lib/schemas/visual-continuity.js';
import {
	applyContinuityDecision,
	buildContinuityReportMarkdown,
	buildVisualContinuityReport,
	mergePreviousDecisions,
	visualContinuityReportHash,
	type VisualSceneInput,
} from './visual-continuity.js';
import type { ColorStats } from './color-quality.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const seriesId = '22222222-2222-4222-8222-222222222222';
const characterId = '33333333-3333-4333-8333-333333333333';

function profile(wardrobe = 'sobretudo verde-oliva') {
	return characterIdentityProfileSchema.parse({
		schemaVersion: 1,
		characterId,
		seriesId,
		status: 'APPROVED',
		aliases: ['Lara'],
		visualTraits: {
			hair: 'cabelo preto',
			wardrobe,
			silhouette: 'alta',
			marks: '',
			accessories: '',
		},
		palette: 'verde e âmbar',
		lighting: 'baixa',
		immutableAccessories: [],
		mutableAccessories: [],
		negativePrompts: ['logos'],
		references: [],
		looks: [],
	});
}

function scene(index: number, overrides: Partial<VisualSceneInput> = {}): VisualSceneInput {
	return {
		id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
		sceneIndex: index,
		characterNotes: `Lara entra. FIGURINO: sobretudo verde-oliva`,
		visualDescription: '',
		location: 'Arquivo',
		lightingNotes: '',
		transition: 'cut',
		startFrameAssetId: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
		endFrameAssetId: null,
		...overrides,
	};
}

function stats(meanLuma: number, meanSaturation = 20): ColorStats {
	return {
		frameCount: 1,
		meanLuma,
		p05Luma: Math.max(0, meanLuma - 20),
		p95Luma: Math.min(255, meanLuma + 20),
		lowClipPct: 0,
		highClipPct: 0,
		meanSaturation,
	};
}

function input(scenes: VisualSceneInput[], frameStats: Record<string, ColorStats> = {}) {
	return {
		episodeId,
		seriesId,
		episodeNumber: 4,
		episodeRevisionNumber: 2,
		generatedAt: '2026-11-19T12:00:00.000Z',
		scenes,
		characters: [{ id: characterId, name: 'Lara', version: 3, profile: profile() }],
		frameStats,
	};
}

describe('visual continuity report', () => {
	it('flags wardrobe contradictions and keeps coherent notes unflagged', () => {
		const report = buildVisualContinuityReport(
			input([scene(1), scene(2, { characterNotes: 'Lara entra. FIGURINO: vestido vermelho' })]),
		);
		const mismatch = report.observations.find(
			(observation) => observation.attribute === 'wardrobe',
		);
		expect(mismatch).toMatchObject({
			entityType: 'CHARACTER',
			characterId,
			status: 'NEEDS_REVIEW',
			method: 'METADATA',
			confidence: 'MEDIUM',
		});
		expect(mismatch?.expected).toContain('sobretudo verde-oliva');
		expect(mismatch?.observed).toContain('vestido vermelho');
		expect(
			report.observations.filter((observation) => observation.attribute === 'wardrobe'),
		).toHaveLength(1);
		expect(report.status).toBe('NEEDS_REVIEW');
	});

	it('flags missing frames without treating them as blocking', () => {
		const report = buildVisualContinuityReport(
			input([scene(1, { startFrameAssetId: null, endFrameAssetId: null })]),
		);
		expect(report.observations[0]).toMatchObject({
			entityType: 'FRAME',
			attribute: 'frame',
			status: 'NEEDS_REVIEW',
			confidence: 'HIGH',
		});
		expect(report.status).toBe('NEEDS_REVIEW');
		expect(report.summary.blocking).toBe(0);
	});

	it('suggests lighting and location changes from adjacent scenes', () => {
		const first = scene(1);
		const second = scene(2, {
			characterNotes: 'Lara entra. FIGURINO: sobretudo verde-oliva',
			location: 'Corredor',
			transition: 'cut',
		});
		const report = buildVisualContinuityReport(
			input([first, second], {
				[first.startFrameAssetId!]: stats(20, 10),
				[second.startFrameAssetId!]: stats(130, 70),
			}),
		);
		expect(report.observations.some((observation) => observation.entityType === 'LIGHTING')).toBe(
			true,
		);
		expect(
			report.observations.find((observation) => observation.entityType === 'LOCATION'),
		).toMatchObject({ confidence: 'LOW', status: 'NEEDS_REVIEW' });
	});

	it('applies owner decisions and only blocks when explicitly marked', () => {
		const report = buildVisualContinuityReport(
			input([scene(1, { startFrameAssetId: null, endFrameAssetId: null })]),
		);
		const observation = report.observations[0]!;
		expect(observation.entityType).toBe('FRAME');
		const exception = applyContinuityDecision(
			report,
			{
				observationId: observation.id,
				status: 'EXCEPTION',
				rationale: 'Mudança de luz intencional para a cena onírica.',
				action: 'NONE',
			},
			'2026-11-19T12:05:00.000Z',
		);
		expect(exception.status).toBe('ACCEPTED');
		expect(exception.summary.exceptions).toBe(1);
		const blocking = applyContinuityDecision(report, {
			observationId: observation.id,
			status: 'BLOCKING',
			rationale: 'Figurino errado; regenerar no Flow.',
			action: 'REGENERATE',
		});
		expect(blocking.status).toBe('BLOCKING');
		expect(blocking.observations[0]?.decisionNote).toContain('[REGENERATE]');
	});

	it('merges earlier decisions into a regenerated report by stable id', () => {
		const first = buildVisualContinuityReport(
			input([scene(1, { startFrameAssetId: null, endFrameAssetId: null })]),
		);
		const accepted = applyContinuityDecision(first, {
			observationId: first.observations[0]!.id,
			status: 'ACCEPTED',
			rationale: 'Frame ausente aceito nesta revisão.',
			action: 'NONE',
		});
		const regenerated = buildVisualContinuityReport({
			...input([scene(1, { startFrameAssetId: null, endFrameAssetId: null })]),
			generatedAt: '2026-11-19T12:10:00.000Z',
			previous: accepted,
		});
		expect(regenerated.observations[0]?.status).toBe('ACCEPTED');
		expect(regenerated.status).toBe('ACCEPTED');
		expect(mergePreviousDecisions(regenerated, null)).toBe(regenerated);
	});

	it('is deterministic and exports a report without private URLs', () => {
		const deterministicInput = () =>
			input([scene(1, { startFrameAssetId: null, endFrameAssetId: null })]);
		const first = buildVisualContinuityReport(deterministicInput());
		const second = buildVisualContinuityReport(deterministicInput());
		expect(visualContinuityReportHash(first)).toBe(visualContinuityReportHash(second));
		const markdown = buildContinuityReportMarkdown(first, 'Episódio 4');
		expect(markdown).toContain('Visual continuity report');
		expect(markdown).toContain('NEEDS_REVIEW');
		expect(markdown).toContain('Limitations');
		expect(markdown).not.toMatch(/https?:\/\//);
	});

	it('records characters without profiles as a limitation and does not call an empty report accepted', () => {
		const report = buildVisualContinuityReport({
			...input([]),
			characters: [{ id: characterId, name: 'Lara', version: 0, profile: null }],
		});
		expect(report.observations).toHaveLength(0);
		expect(report.limitations.join(' ')).toContain('no identity profile');
		expect(report.status).toBe('NEEDS_REVIEW');
	});

	it('round-trips sampled frame stats through the schema and keeps the hash stable', () => {
		const frame = scene(1).startFrameAssetId!;
		const report = buildVisualContinuityReport(
			input([scene(1)], { [frame]: stats(42.123456, 18.987654) }),
		);
		const parsed = visualContinuityReportSchema.parse(report);
		expect(parsed.frames[0]?.stats).toMatchObject({
			frameCount: 1,
			meanLuma: 42.123,
			meanSaturation: 18.988,
		});
		expect(visualContinuityReportHash(parsed)).toBe(visualContinuityReportHash(report));
	});

	it('caps an oversized report to schema limits while preserving blocking decisions', () => {
		const otherCharacter = '99999999-9999-4999-8999-999999999999';
		const otherProfile = characterIdentityProfileSchema.parse({
			...profile(),
			characterId: otherCharacter,
			aliases: ['Mestre'],
			visualTraits: {
				hair: 'careca',
				wardrobe: 'paletó cinza',
				silhouette: 'baixa',
				marks: '',
				accessories: '',
			},
		});
		const scenes: VisualSceneInput[] = Array.from({ length: 60 }, (_, index) =>
			scene(index + 1, {
				characterNotes: 'Lara e Mestre entram. FIGURINO: roupas erradas. CABELO: errado',
			}),
		);
		const extraCharacters = Array.from({ length: 12 }, (_, index) => ({
			id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
			name: `Extra ${index + 1}`,
			version: 1,
			profile: characterIdentityProfileSchema.parse({
				...profile(),
				characterId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
				aliases: [],
			}),
		}));
		const report = buildVisualContinuityReport({
			...input(scenes),
			characters: [
				{ id: characterId, name: 'Lara', version: 1, profile: profile() },
				{ id: otherCharacter, name: 'Mestre', version: 1, profile: otherProfile },
				...extraCharacters,
			],
		});
		expect(report.observations.length).toBeLessThanOrEqual(200);
		expect(report.limitations[0]).toContain('truncated');
		expect(report.limitations.length).toBeLessThanOrEqual(10);
		expect(visualContinuityReportSchema.safeParse(report).success).toBe(true);
	});

	it('does not carry accepted/exception/resolved decisions to changed evidence', () => {
		for (const status of ['ACCEPTED', 'EXCEPTION', 'RESOLVED'] as const) {
			const original = buildVisualContinuityReport(
				input([scene(2, { characterNotes: 'Lara entra. FIGURINO: vestido vermelho' })]),
			);
			const decided = applyContinuityDecision(original, {
				observationId: original.observations[0]!.id,
				status,
				rationale: 'Decisão da evidência antiga.',
				action: 'NONE',
			});
			const regenerated = buildVisualContinuityReport({
				...input([scene(2, { characterNotes: 'Lara entra. FIGURINO: vestido verde' })]),
				previous: decided,
			});
			expect(regenerated.observations[0]?.status).toBe('NEEDS_REVIEW');
			expect(regenerated.observations[0]?.decisionNote).toBe('');
			expect(regenerated.status).toBe('NEEDS_REVIEW');
		}
	});

	it('preserves an explicit blocking decision when the evidence text changes', () => {
		const original = buildVisualContinuityReport(
			input([scene(2, { characterNotes: 'Lara entra. FIGURINO: vestido vermelho' })]),
		);
		const blocking = applyContinuityDecision(original, {
			observationId: original.observations[0]!.id,
			status: 'BLOCKING',
			rationale: 'Figurino errado.',
			action: 'REGENERATE',
		});
		const regenerated = buildVisualContinuityReport({
			...input([scene(2, { characterNotes: 'Lara entra. FIGURINO: vestido verde' })]),
			previous: blocking,
		});
		expect(regenerated.observations[0]?.id).not.toBe(blocking.observations[0]?.id);
		expect(regenerated.observations[0]?.status).toBe('BLOCKING');
		expect(regenerated.observations[0]?.decisionNote).toContain('[REGENERATE]');
		expect(regenerated.status).toBe('BLOCKING');
	});
});
