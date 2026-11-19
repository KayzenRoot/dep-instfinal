import { describe, expect, it } from 'vitest';
import { characterIdentityProfileSchema } from '#lib/schemas/character-identity.js';
import {
	buildContinuityChecklist,
	buildIdentityAnchor,
	buildIdentityChecklistMarkdown,
	buildSceneIdentityPrompts,
	composeIdentityPrompt,
	identityProfileHash,
	selectIdentityLook,
} from './character-identity.js';

const seriesA = '11111111-1111-4111-8111-111111111111';
const seriesB = '22222222-2222-4222-8222-222222222222';
const characterA = '33333333-3333-4333-8333-333333333333';

function profile(overrides: Record<string, unknown> = {}) {
	return characterIdentityProfileSchema.parse({
		schemaVersion: 1,
		characterId: characterA,
		seriesId: seriesA,
		status: 'APPROVED',
		aliases: ['Lará', 'A Arquivista'],
		visualTraits: {
			hair: 'cabelo preto na altura dos ombros',
			wardrobe: 'sobretudo verde-oliva',
			silhouette: 'alta e angular',
			marks: 'cicatriz na sobrancelha esquerda',
			accessories: 'colar de prata',
		},
		palette: 'verde dessaturado e âmbar',
		lighting: 'luz prática baixa',
		immutableAccessories: ['colar de prata'],
		mutableAccessories: ['luvas'],
		negativePrompts: ['logos modernos', 'neon brilhante'],
		references: [],
		looks: [
			{
				id: 'arquivo',
				label: 'Arquivo',
				appliesFromEpisode: 1,
				appliesToEpisode: 3,
				wardrobe: 'sobretudo verde-oliva',
				hair: 'cabelo preto na altura dos ombros',
			},
			{
				id: 'pos-ritual',
				label: 'Pós-ritual',
				appliesFromEpisode: 4,
				appliesToEpisode: null,
				wardrobe: 'casaco cinza rasgado',
				hair: 'cabelo preso',
			},
		],
		...overrides,
	});
}

describe('character identity', () => {
	it('selects the look valid for the episode and keeps the anchor stable inside it', () => {
		const value = profile();
		expect(selectIdentityLook(value, 2)?.id).toBe('arquivo');
		expect(selectIdentityLook(value, 5)?.id).toBe('pos-ritual');
		const anchor1 = buildIdentityAnchor(value, 'Lara', 1);
		const anchor2 = buildIdentityAnchor(value, 'Lara', 2);
		expect(anchor1).toBe(anchor2);
		expect(anchor1).toContain('sobretudo verde-oliva');
		expect(buildIdentityAnchor(value, 'Lara', 5)).toContain('casaco cinza rasgado');
	});

	it('rejects overlapping look ranges and invalid episode numbers', () => {
		const base = profile();
		expect(
			characterIdentityProfileSchema.safeParse({
				...base,
				looks: [
					{
						id: 'look-1',
						label: 'A',
						appliesFromEpisode: 1,
						appliesToEpisode: 4,
						wardrobe: 'a',
						hair: '',
						notes: '',
					},
					{
						id: 'look-2',
						label: 'B',
						appliesFromEpisode: 4,
						appliesToEpisode: null,
						wardrobe: 'b',
						hair: '',
						notes: '',
					},
				],
			}).success,
		).toBe(false);
	});

	it('honors a manual anchor override and produces stable hashes', () => {
		const first = profile({ anchorOverrideEn: 'Lara: fixed manual anchor.' });
		expect(buildIdentityAnchor(first, 'Lara', 5)).toBe('Lara: fixed manual anchor.');
		expect(identityProfileHash(first)).toBe(
			identityProfileHash(profile({ anchorOverrideEn: 'Lara: fixed manual anchor.' })),
		);
		expect(identityProfileHash(profile())).not.toBe(identityProfileHash(first));
	});

	it('builds an English checklist that records deliberate look changes', () => {
		const checklist = buildContinuityChecklist(profile(), 'Lara', 5);
		expect(checklist.join(' ')).toContain('Wardrobe look "Pós-ritual"');
		expect(checklist.join(' ')).toContain('from episode 4 onward');
		expect(checklist.join(' ')).toContain('Never remove immutable items');
		expect(checklist.join(' ')).toContain('Do not include');
	});

	it('matches accents and aliases, and reports characters without profiles', () => {
		const bundle = buildSceneIdentityPrompts(
			[
				{
					id: '44444444-4444-4444-8444-444444444444',
					sceneIndex: 1,
					characterNotes: 'LARA espera na sala. VESTUARIO: sobretudo verde-oliva',
					visualDescription: '',
					startFramePromptEn: 'wide shot of a dark archive',
				},
				{
					id: '55555555-5555-4555-8555-555555555555',
					sceneIndex: 2,
					characterNotes: 'A ARQUIVISTA encontra a fita',
					visualDescription: '',
					startFramePromptEn: 'close-up of a tape',
				},
				{
					id: '66666666-6666-4666-8666-666666666666',
					sceneIndex: 3,
					characterNotes: 'Ninguém aparece',
					visualDescription: '',
					startFramePromptEn: 'empty corridor',
				},
			],
			[
				{ characterId: characterA, name: 'Lara', version: 4, profile: profile() },
				{
					characterId: '77777777-7777-4777-8777-777777777777',
					name: 'Mestre',
					version: 0,
					profile: null,
				},
			],
			1,
		);
		expect(bundle.rows).toHaveLength(2);
		expect(bundle.rows[0]?.anchor).toContain('sobretudo verde-oliva');
		expect(bundle.rows[0]?.composedPrompt).toContain('wide shot of a dark archive');
		expect(bundle.rows[0]?.composedPrompt).toContain('Negative constraints: logos modernos');
		expect(bundle.unmatchedScenes).toEqual([3]);
		expect(bundle.missingProfiles).toEqual([]);
		expect(bundle.limitations.join(' ')).toContain('exact names/aliases');
	});

	it('keeps two series with homonyms distinguishable through character/series ids', () => {
		const other = profile({
			characterId: '88888888-8888-4888-8888-888888888888',
			seriesId: seriesB,
			aliases: ['Lara'],
		});
		expect(identityProfileHash(profile())).not.toBe(identityProfileHash(other));
		expect(
			buildIdentityChecklistMarkdown(
				'Série A',
				[{ characterId: characterA, name: 'Lara', version: 1, profile: profile() }],
				1,
			),
		).toContain('## Lara (profile v1)');
	});

	it('composes scene prompt, anchor, checklist and negatives in order', () => {
		const prompt = composeIdentityPrompt(
			'wide shot',
			'Lara: anchor.',
			['Keep hair.', 'Keep wardrobe.'],
			['no logo'],
		);
		expect(prompt.indexOf('wide shot')).toBeLessThan(prompt.indexOf('Character anchor'));
		expect(prompt.indexOf('Continuity checklist')).toBeLessThan(
			prompt.indexOf('Negative constraints'),
		);
	});

	it('keeps two characters and four scenes distinct with stable per-character anchors', () => {
		const lara = profile();
		const mestre = profile({
			characterId: '88888888-8888-4888-8888-888888888888',
			aliases: ['O Mestre'],
			visualTraits: {
				hair: 'careca',
				wardrobe: 'paletó cinza',
				silhouette: 'baixa e larga',
				marks: 'queimadura na mão',
				accessories: 'bengala',
			},
			looks: [],
		});
		const scenes = [
			['Lara abre o arquivo.', 'archive'],
			['Lara encontra o Mestre.', 'hallway'],
			['O Mestre oferece a fita.', 'office'],
			['Lara recusa e sai.', 'exit'],
		].map(([notes, prompt], index) => ({
			id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`,
			sceneIndex: index + 1,
			characterNotes: notes ?? '',
			visualDescription: '',
			startFramePromptEn: prompt ?? '',
		}));
		const bundle = buildSceneIdentityPrompts(
			scenes,
			[
				{ characterId: characterA, name: 'Lara', version: 1, profile: lara },
				{
					characterId: '88888888-8888-4888-8888-888888888888',
					name: 'Mestre',
					version: 1,
					profile: mestre,
				},
			],
			2,
		);
		expect(bundle.rows).toHaveLength(4);
		const laraAnchor = buildIdentityAnchor(lara, 'Lara', 2);
		const laraRows = bundle.rows.filter((row) => row.characterNames.includes('Lara'));
		expect(laraRows.length).toBeGreaterThan(1);
		expect(laraRows.every((row) => row.anchor.includes(laraAnchor))).toBe(true);
		expect(bundle.rows[1]?.anchor).toContain('Lara');
		expect(bundle.rows[1]?.anchor).toContain('Mestre');
		expect(new Set(bundle.rows.map((row) => row.composedPrompt)).size).toBe(4);
	});
});
