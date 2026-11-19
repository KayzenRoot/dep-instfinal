import { beforeEach, describe, expect, it, vi } from 'vitest';

const covers = vi.hoisted(() => {
	class CoverError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return {
		CoverError,
		loadCoverContext: vi.fn(),
		loadCoverRevision: vi.fn(),
		saveCoverRevision: vi.fn(),
		restoreCoverRevision: vi.fn(),
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

vi.mock('#lib/server/cover.js', () => covers);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/episode-options.js', () => episodes);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));

import { actions } from './+page.server.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';

function event(fields: Record<string, string>, extra: Array<[string, string]> = []) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	for (const [key, value] of extra) form.append(key, value);
	return {
		request: new Request('http://localhost/app/covers?/generate', {
			method: 'POST',
			body: form,
		}),
		url: new URL('http://localhost/app/covers'),
	} as never;
}

function fields(overrides: Record<string, string> = {}) {
	return {
		episodeId,
		expectedRevision: '0',
		title: 'A fita amaldiçoada',
		subtitle: '',
		badge: 'E01',
		format: '4:5',
		frameAssetId: '',
		focusX: '0.5',
		focusY: '0.5',
		watermark: 'on',
		...overrides,
	};
}

describe('cover page actions', () => {
	beforeEach(() => {
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		covers.loadCoverContext.mockResolvedValue({
			episode: {
				id: episodeId,
				number: 1,
				title: 'Episódio',
				seriesTitle: 'Arquivo 17',
			},
			frames: [],
			assets: [],
			revisions: [],
		});
		covers.saveCoverRevision
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(3);
		covers.loadCoverRevision.mockResolvedValue({
			id: revisionId,
			episodeId,
			revision: 3,
			templateId: 'noir',
			format: '4:5',
			status: 'DRAFT',
			config: {
				schemaVersion: 1,
				templateId: 'noir',
				templateVersion: 1,
				format: '4:5',
				frameAssetId: null,
				title: 'A fita amaldiçoada',
				subtitle: '',
				badge: 'E01',
				seriesTitle: 'Arquivo 17',
				focusX: 0.5,
				focusY: 0.5,
				watermark: true,
			},
			createdAt: '2026-11-19T00:00:00Z',
		});
		covers.restoreCoverRevision.mockResolvedValue(4);
	});

	it('generates the selected templates and redirects', async () => {
		await expect(
			actions.generate(
				event(fields(), [
					['templates', 'noir'],
					['templates', 'vhs_polaroid'],
					['templates', 'archive'],
				]),
			),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/covers?episodeId=${episodeId}&generated=3`,
		});
		expect(covers.saveCoverRevision).toHaveBeenCalledTimes(3);
		expect(covers.saveCoverRevision.mock.calls[0]?.[0]).toMatchObject({
			expectedRevision: 0,
			config: { templateId: 'noir', format: '4:5', seriesTitle: 'Arquivo 17' },
		});
		expect(covers.saveCoverRevision.mock.calls[2]?.[0]).toMatchObject({
			expectedRevision: 2,
			config: { templateId: 'archive' },
		});
	});

	it('rejects invalid cover fields before saving', async () => {
		expect(await actions.generate(event(fields({ focusX: 'abc' })))).toMatchObject({
			status: 400,
		});
		expect(covers.saveCoverRevision).not.toHaveBeenCalled();
		expect(await actions.generate(event(fields({ expectedRevision: '' })))).toMatchObject({
			status: 400,
		});
	});

	it('approves and restores a revision', async () => {
		covers.saveCoverRevision.mockReset();
		covers.saveCoverRevision.mockResolvedValue(3);
		await expect(
			actions.approve(event({ revisionId, expectedRevision: '3' })),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/covers?episodeId=${episodeId}&approved=3`,
		});
		await expect(
			actions.restore(event({ revisionId, expectedRevision: '3' })),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/covers?episodeId=${episodeId}&restored=4`,
		});
		expect(covers.saveCoverRevision).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'APPROVED' }),
		);
		expect(covers.restoreCoverRevision).toHaveBeenCalledWith(
			expect.objectContaining({ revisionId, expectedRevision: 3 }),
		);
	});
});
