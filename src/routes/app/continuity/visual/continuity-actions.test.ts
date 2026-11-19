import { beforeEach, describe, expect, it, vi } from 'vitest';

const continuity = vi.hoisted(() => {
	class VisualContinuityError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return {
		VisualContinuityError,
		loadOwnerEpisodeSelection: vi.fn(),
		loadContinuityInspectorContext: vi.fn(),
		generateVisualContinuityReport: vi.fn(),
		decideVisualContinuity: vi.fn(),
	};
});
const episodes = vi.hoisted(() => ({ loadOwnerEpisodeSelection: vi.fn() }));
const authorized = vi.hoisted(() => ({
	ownerDatabase: vi.fn(),
	readFormText: (form: FormData, key: string) => {
		const value = form.get(key);
		return typeof value === 'string' ? value : '';
	},
}));

vi.mock('#lib/server/visual-continuity.js', () => continuity);
vi.mock('#lib/server/episode-options.js', () => episodes);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));

import { actions } from './+page.server.js';

const episodeId = '11111111-1111-4111-8111-111111111111';

function event(fields: Record<string, string>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return {
		request: new Request('http://localhost/app/continuity/visual?/generate', {
			method: 'POST',
			body: form,
		}),
		url: new URL('http://localhost/app/continuity/visual'),
	} as never;
}

describe('visual continuity actions', () => {
	beforeEach(() => {
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		continuity.generateVisualContinuityReport.mockResolvedValue({ revision: 2 });
		continuity.decideVisualContinuity.mockResolvedValue(3);
	});

	it('generates a report and redirects to its revision', async () => {
		await expect(actions.generate(event({ episodeId }))).rejects.toMatchObject({
			status: 303,
			location: `/app/continuity/visual?episodeId=${episodeId}&generated=2`,
		});
		expect(continuity.generateVisualContinuityReport).toHaveBeenCalledWith(
			expect.objectContaining({ episodeId }),
		);
	});

	it('forwards decisions including explicit regeneration', async () => {
		await expect(
			actions.decide(
				event({
					episodeId,
					observationId: 'obs_0123456789ab',
					status: 'BLOCKING',
					rationale: 'Regenerar no Flow.',
					regenerate: 'on',
				}),
			),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/continuity/visual?episodeId=${episodeId}&decided=3`,
		});
		expect(continuity.decideVisualContinuity).toHaveBeenCalledWith(
			expect.objectContaining({
				episodeId,
				decision: {
					observationId: 'obs_0123456789ab',
					status: 'BLOCKING',
					rationale: 'Regenerar no Flow.',
					action: 'REGENERATE',
				},
			}),
		);
	});

	it('rejects incomplete decisions and maps domain conflicts', async () => {
		expect(await actions.decide(event({ episodeId }))).toMatchObject({ status: 400 });
		continuity.decideVisualContinuity.mockRejectedValue(
			new continuity.VisualContinuityError(409, 'CONTINUITY_REVISION_CONFLICT', 'Recarregue.'),
		);
		await expect(
			actions.decide(
				event({
					episodeId,
					observationId: 'obs_0123456789ab',
					status: 'ACCEPTED',
					rationale: 'ok',
				}),
			),
		).resolves.toMatchObject({ status: 409, data: { message: 'Recarregue.' } });
	});
});
