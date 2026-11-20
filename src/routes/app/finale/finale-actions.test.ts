import { beforeEach, describe, expect, it, vi } from 'vitest';

const cards = vi.hoisted(() => {
	class ChoiceEndCardError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return {
		ChoiceEndCardError,
		loadChoiceEndCard: vi.fn(),
		loadChoiceEndCardContext: vi.fn(),
		saveChoiceEndCard: vi.fn(),
	};
});
const plans = vi.hoisted(() => {
	class VideoEditPlanError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return {
		VideoEditPlanError,
		defaultEditPlan: vi.fn(),
		loadEditPlan: vi.fn(),
		loadEditPlanContext: vi.fn(),
		saveVideoEditPlan: vi.fn(),
	};
});
const authorized = vi.hoisted(() => ({
	ownerDatabase: vi.fn(),
	readFormText: (form: FormData, key: string) => {
		const value = form.get(key);
		return typeof value === 'string' ? value : '';
	},
}));
const episodes = vi.hoisted(() => ({ loadOwnerEpisodeSelection: vi.fn() }));

vi.mock('#lib/server/choice-end-card.js', () => cards);
vi.mock('#lib/server/video-edit-plans.js', () => plans);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock('#lib/server/episode-options.js', () => episodes);

import { actions } from './+page.server.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const choices = [
	{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', optionKey: '1', label: 'ENTRAR' },
	{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', optionKey: '2', label: 'FUGIR' },
];
const config = {
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
};

function event(fields: Record<string, string>, extra: Array<[string, string]> = []) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	for (const [key, value] of extra) form.append(key, value);
	return {
		request: new Request('http://localhost/app/finale?/generate', {
			method: 'POST',
			body: form,
		}),
		url: new URL('http://localhost/app/finale'),
	} as never;
}

function fields(overrides: Record<string, string> = {}) {
	return {
		episodeId,
		expectedRevision: '0',
		templateId: 'doors',
		durationMs: '6000',
		prompt: 'Qual caminho você escolhe?',
		footer: 'Comente A ou B',
		reveal: 'progressive',
		sfx: 'beep',
		sfxVolumeDb: '-12',
		narration: 'mute',
		...overrides,
	};
}

describe('finale page actions', () => {
	beforeEach(() => {
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		cards.loadChoiceEndCardContext.mockResolvedValue({
			episode: {
				id: episodeId,
				title: 'Episódio',
				number: 10,
				durationMs: 90_000,
				status: 'DRAFT',
				isFinale: true,
				seriesTitle: 'Arquivo 17',
			},
			choices,
			choiceRevisionNumber: 7,
			revisions: [],
			latestRevision: 0,
		});
		cards.saveChoiceEndCard.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
		cards.loadChoiceEndCard.mockResolvedValue({
			id: revisionId,
			episodeId,
			revision: 2,
			choiceRevisionNumber: 7,
			choices,
			config,
			status: 'APPROVED',
			hashVersion: 1,
			createdAt: '2026-11-20T00:00:00Z',
		});
		plans.loadEditPlanContext.mockResolvedValue({
			episodeId,
			episodeRevisionNumber: 7,
			durationMs: 90_000,
			sceneDurationMs: 6_000,
			scenes: [],
			assets: [],
		});
		plans.defaultEditPlan.mockReturnValue({
			schemaVersion: 1,
			episodeId,
			episodeRevisionNumber: 7,
			durationMs: 90_000,
			sceneDurationMs: 6_000,
			fps: 30,
			tracks: [{ id: 'video-main', kind: 'video', label: 'Vídeo principal' }],
			clips: [],
			captions: { template: 'clean' },
			cta: null,
		});
		plans.loadEditPlan.mockResolvedValue({ plan: null, versions: [] });
		plans.saveVideoEditPlan.mockResolvedValue(1);
	});

	it('generates the selected layouts as sequential revisions', async () => {
		await expect(
			actions.generate(
				event(fields(), [
					['layouts', 'split'],
					['layouts', 'stacked'],
				]),
			),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/finale?episodeId=${episodeId}&generated=2`,
		});
		expect(cards.saveChoiceEndCard).toHaveBeenCalledTimes(2);
		expect(cards.saveChoiceEndCard.mock.calls[0]?.[0]).toMatchObject({
			expectedRevision: 0,
			config: { templateId: 'doors', layout: 'split' },
		});
		expect(cards.saveChoiceEndCard.mock.calls[1]?.[0]).toMatchObject({
			expectedRevision: 1,
			config: { templateId: 'doors', layout: 'stacked' },
		});
	});

	it('rejects an unknown preset before saving', async () => {
		expect(await actions.generate(event(fields({ templateId: 'vhs' })))).toMatchObject({
			status: 400,
		});
		expect(cards.saveChoiceEndCard).not.toHaveBeenCalled();
	});

	it('attaches an approved revision to the timeline at the episode end', async () => {
		plans.saveVideoEditPlan.mockResolvedValue(3);
		await expect(
			actions.attach(event({ episodeId, revisionId, expectedVersion: '2' })),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/finale?episodeId=${episodeId}&attached=3`,
		});
		expect(plans.saveVideoEditPlan).toHaveBeenCalledWith(
			expect.objectContaining({
				episodeId,
				expectedVersion: 0,
				plan: expect.objectContaining({
					endCard: expect.objectContaining({
						cardId: revisionId,
						cardRevision: 2,
						startMs: 84_000,
						endMs: 90_000,
					}),
				}),
			}),
		);
	});

	it('maps a stale card error to a 409 without redirecting', async () => {
		plans.saveVideoEditPlan.mockRejectedValue(
			new cards.ChoiceEndCardError(409, 'END_CARD_STALE', 'Escolhas mudaram.'),
		);
		expect(
			await actions.attach(event({ episodeId, revisionId, expectedVersion: '0' })),
		).toMatchObject({ status: 409 });
		expect(plans.saveVideoEditPlan).toHaveBeenCalledTimes(1);
	});
});
