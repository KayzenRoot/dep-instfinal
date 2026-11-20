import { describe, expect, it } from 'vitest';
import {
	choiceEndCardConfigSchema,
	type ChoiceEndCardConfig,
} from '#lib/schemas/choice-end-card.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';
import { buildSceneTimeline } from './timeline.js';
import {
	buildEndCardAss,
	buildEndCardSfxWav,
	END_CARD_TEMPLATES,
	END_CARD_TEMPLATE_LIST,
	EndCardError,
	endCardLayout,
	wrapEndCardText,
} from './choice-end-card.js';
import { choiceEndCardConfigHash, choiceSetHash } from './choice-end-card-hash.js';
import {
	buildDefaultEditPlan,
	EditPlanError,
	validateEditPlan,
	type EditPlanContext,
} from './video-edit-plan.js';

const choices = [
	{
		id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		optionKey: '1' as const,
		label: 'ENTRAR',
		consequence: 'Entra na sala.',
	},
	{
		id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		optionKey: '2' as const,
		label: 'FUGIR',
		consequence: 'Foge da sala.',
	},
];

const config: ChoiceEndCardConfig = choiceEndCardConfigSchema.parse({
	schemaVersion: 1,
	templateId: 'doors',
	layout: 'split',
	durationMs: 6_000,
	prompt: 'Qual caminho você escolhe?',
	footer: 'Comente A ou B',
	reveal: 'progressive',
	reducedMotion: false,
	sfx: 'beep',
	sfxVolumeDb: -12,
	narration: 'mute',
});

const endCard = {
	...config,
	cardId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
	cardRevision: 3,
	choiceRevisionNumber: 7,
	startMs: 54_000,
	endMs: 60_000,
	choices,
};

const safeArea = { x: 48, y: 180, width: 984, height: 1_500 };

function context(durationMs = 90_000): EditPlanContext {
	const scenes = buildSceneTimeline(durationMs, 6_000).map((scene) => ({
		id: `00000000-0000-4000-8000-${String(scene.index).padStart(12, '0')}`,
		sceneIndex: scene.index,
		startMs: scene.startMs,
		endMs: scene.endMs,
	}));
	return {
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 7,
		durationMs,
		sceneDurationMs: 6_000,
		scenes,
		assets: scenes.map((scene) => ({
			id: `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`,
			sceneId: scene.id,
			assetVersion: 1,
			durationMs: 6_000,
		})),
	};
}

describe('choice end card presets and layout', () => {
	it('ships six distinct versioned presets', () => {
		expect(END_CARD_TEMPLATE_LIST).toHaveLength(6);
		expect(new Set(END_CARD_TEMPLATE_LIST.map((template) => template.label)).size).toBe(6);
		expect(new Set(END_CARD_TEMPLATE_LIST.map((template) => template.description)).size).toBe(6);
		for (const template of END_CARD_TEMPLATE_LIST) expect(template.version).toBe(1);
	});

	it('keeps split and stacked panels inside the safe area', () => {
		for (const layout of ['split', 'stacked'] as const) {
			const boxes = endCardLayout(safeArea, layout);
			expect(boxes.panels).toHaveLength(2);
			for (const panel of boxes.panels) {
				expect(panel.x).toBeGreaterThanOrEqual(safeArea.x);
				expect(panel.y).toBeGreaterThanOrEqual(safeArea.y);
				expect(panel.x + panel.width).toBeLessThanOrEqual(safeArea.x + safeArea.width);
				expect(panel.y + panel.height).toBeLessThanOrEqual(safeArea.y + safeArea.height);
			}
			expect(boxes.footer.y + boxes.footer.height).toBeLessThanOrEqual(
				safeArea.y + safeArea.height,
			);
		}
	});

	it('wraps labels but refuses to silently truncate a long choice', () => {
		expect(wrapEndCardText('UMA GRAVAÇÃO ENCONTRADA', 10, 3)).toEqual([
			'UMA',
			'GRAVAÇÃO',
			'ENCONTRADA',
		]);
		expect(() => wrapEndCardText('PALAVRA '.repeat(40), 8, 2, 'Escolha A')).toThrow(EndCardError);
	});
});

describe('end card ASS overlay', () => {
	it('draws A/B, prompt, footer and the two panels with the configured preset', () => {
		for (const templateId of Object.keys(END_CARD_TEMPLATES) as Array<
			keyof typeof END_CARD_TEMPLATES
		>) {
			const ass = buildEndCardAss({ ...endCard, templateId }, safeArea);
			expect(ass).toContain('PlayResX: 1080');
			expect(ass).toContain('\\fn');
			expect(ass).toContain('A');
			expect(ass).toContain('B');
			expect(ass).toContain('ENTRAR');
			expect(ass).toContain('FUGIR');
			expect(ass).toContain('Comente A ou B');
			expect(ass).toContain('\\fad(180,220)');
			expect(ass).toContain('Dialogue: 1');
		}
	});

	it('escapes ASS control characters and removes motion when reduced', () => {
		const ass = buildEndCardAss(
			{
				...endCard,
				reducedMotion: true,
				prompt: 'Escolha {A}\\B',
				choices: [
					{ ...choices[0]!, label: 'ENTRAR {agora}' },
					{ ...choices[1]!, label: 'FUGIR \\ já' },
				],
			},
			safeArea,
		);
		expect(ass).not.toContain('{agora}');
		expect(ass).toContain('\uFF5Bagora\uFF5D');
		expect(ass).toContain('\uFF3C já');
		expect(ass).not.toContain('\\fad');
	});

	it('rejects a window shorter than three seconds', () => {
		expect(() => buildEndCardAss({ ...endCard, endMs: endCard.startMs + 2_999 }, safeArea)).toThrow(
			EndCardError,
		);
	});
});

describe('end card hashes and audio', () => {
	it('hashes choices deterministically and changes with labels', () => {
		expect(choiceSetHash(choices)).toBe(choiceSetHash([...choices].reverse()));
		expect(choiceSetHash(choices)).not.toBe(
			choiceSetHash([choices[0]!, { ...choices[1]!, label: 'CORRER' }]),
		);
		expect(choiceSetHash(choices)).not.toBe(
			choiceSetHash([choices[0]!, { ...choices[1]!, consequence: 'Outro destino.' }]),
		);
		const hash = choiceEndCardConfigHash(config, choices);
		expect(hash).toBe(choiceEndCardConfigHash({ ...config }, choices));
		expect(hash).not.toBe(choiceEndCardConfigHash({ ...config, prompt: 'Outro' }, choices));
		expect(hash).not.toBe(
			choiceEndCardConfigHash(config, [choices[0]!, { ...choices[1]!, label: 'CORRER' }]),
		);
		expect(() => choiceEndCardConfigHash(config, choices, 2)).toThrow(EndCardError);
	});

	it('synthesizes deterministic stereo WAV SFX and honors volume', () => {
		const beep = buildEndCardSfxWav('beep', 3_000, -12);
		expect(beep).not.toBeNull();
		expect(beep!.subarray(0, 4).toString()).toBe('RIFF');
		expect(beep!.readUInt16LE(22)).toBe(2);
		expect(beep!.readUInt32LE(24)).toBe(48_000);
		expect(beep!.length).toBe(44 + 3 * 48_000 * 2 * 2);
		expect(buildEndCardSfxWav('beep', 3_000, -12)!.equals(beep!)).toBe(true);
		const quieter = buildEndCardSfxWav('beep', 3_000, -24)!;
		let louderPeak = 0;
		let quieterPeak = 0;
		for (let index = 44; index < beep!.length; index += 2) {
			louderPeak = Math.max(louderPeak, Math.abs(beep!.readInt16LE(index)));
			quieterPeak = Math.max(quieterPeak, Math.abs(quieter!.readInt16LE(index)));
		}
		expect(quieterPeak).toBeLessThan(louderPeak);
		expect(buildEndCardSfxWav('none', 3_000, -12)).toBeNull();
	});
});

describe('end card in the edit plan', () => {
	it('accepts a valid end card and rejects CTA plus end card', () => {
		const plan = buildDefaultEditPlan(context());
		const planCard = { ...endCard, startMs: 84_000, endMs: 90_000 };
		const withCard = videoEditPlanSchema.parse({ ...plan, endCard: planCard });
		expect(validateEditPlan(withCard, context()).endCard?.choices).toHaveLength(2);
		const withCta = videoEditPlanSchema.parse({
			...plan,
			endCard: planCard,
			cta: { enabled: true, text: 'Comente A ou B', startMs: 80_000, endMs: 89_000 },
		});
		let caught: unknown;
		try {
			validateEditPlan(withCta, context());
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(EditPlanError);
		expect((caught as EditPlanError).code).toBe('EDIT_PLAN_END_CARD_CTA_CONFLICT');
	});

	it('rejects a plan window outside the episode and labels that do not fit', () => {
		const plan = buildDefaultEditPlan(context());
		expect(() =>
			validateEditPlan(
				{ ...plan, endCard: { ...endCard, startMs: 89_000, endMs: 91_000 } },
				context(),
			),
		).toThrow(EditPlanError);
		expect(() =>
			validateEditPlan(
				{ ...plan, endCard: { ...endCard, startMs: 78_000, endMs: 84_000 } },
				context(),
			),
		).toThrow(EditPlanError);
		const longLabel = 'PALAVRA MUITO LONGA '.repeat(12);
		let caught: unknown;
		try {
			validateEditPlan(
				{
					...plan,
					endCard: {
						...endCard,
						startMs: 84_000,
						endMs: 90_000,
						choices: [choices[0]!, { ...choices[1]!, label: longLabel }],
					},
				},
				context(),
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(EditPlanError);
		expect((caught as EditPlanError).code).toBe('END_CARD_TEXT_OVERFLOW');
	});
});
