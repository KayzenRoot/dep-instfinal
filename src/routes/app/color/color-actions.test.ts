import { beforeEach, describe, expect, it, vi } from 'vitest';

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
		loadEditPlan: vi.fn(),
		loadEditPlanContext: vi.fn(),
		VideoEditPlanError,
	};
});
const color = vi.hoisted(() => {
	class ColorGradeError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return { saveColorGrade: vi.fn(), clearColorGrade: vi.fn(), ColorGradeError };
});
const authorized = vi.hoisted(() => ({ ownerDatabase: vi.fn() }));

vi.mock('#lib/server/video-edit-plans.js', () => plans);
vi.mock('#lib/server/color-grade.js', () => color);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));

import { actions } from './+page.server.js';

const episodeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clipId = '11111111-1111-4111-8111-111111111111';

function event(fields: Record<string, string>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return {
		request: new Request('http://localhost/app/color?/save', { method: 'POST', body: form }),
		url: new URL('http://localhost/app/color'),
	} as never;
}

function saveFields(overrides: Record<string, string> = {}) {
	return {
		episodeId,
		expectedVersion: '2',
		presetId: 'cursed_tape',
		strength: '80',
		referenceClipId: clipId,
		overrides: JSON.stringify([{ clipId, strength: 40, exclude: false }]),
		...overrides,
	};
}

describe('color page actions', () => {
	beforeEach(() => {
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		color.saveColorGrade.mockResolvedValue(4);
		color.clearColorGrade.mockResolvedValue(5);
	});

	it('requires the version the owner saw', async () => {
		const result = await actions.save(event(saveFields({ expectedVersion: '' })));
		expect(result).toMatchObject({ status: 400 });
		expect(color.saveColorGrade).not.toHaveBeenCalled();
	});

	it('rejects invalid strength, preset or override JSON with 400', async () => {
		expect(await actions.save(event(saveFields({ strength: '150' })))).toMatchObject({
			status: 400,
		});
		expect(await actions.save(event(saveFields({ overrides: '{' })))).toMatchObject({
			status: 400,
		});
		expect(
			await actions.save(
				event(
					saveFields({ overrides: JSON.stringify([{ clipId, strength: 150, exclude: false }]) }),
				),
			),
		).toMatchObject({ status: 400 });
		expect(color.saveColorGrade).not.toHaveBeenCalled();
	});

	it('forwards the parsed grade and optimistic version', async () => {
		await expect(actions.save(event(saveFields()))).rejects.toMatchObject({
			status: 303,
			location: `/app/color?episodeId=${episodeId}&saved=4`,
		});
		expect(color.saveColorGrade).toHaveBeenCalledWith(
			expect.objectContaining({
				episodeId,
				expectedVersion: 2,
				grade: {
					presetId: 'cursed_tape',
					presetVersion: 1,
					strength: 80,
					referenceClipId: clipId,
					overrides: [{ clipId, strength: 40, exclude: false }],
				},
			}),
		);
	});

	it('maps plan conflicts to their real status instead of 503', async () => {
		for (const [status, code, message] of [
			[400, 'EDIT_PLAN_INVALID', 'Plano inválido.'],
			[404, 'EDIT_PLAN_NOT_FOUND', 'Plano não encontrado.'],
			[409, 'EDIT_PLAN_VERSION_CONFLICT', 'Recarregue antes de salvar.'],
		] as const) {
			color.saveColorGrade.mockRejectedValueOnce(
				new plans.VideoEditPlanError(status, code, message),
			);
			await expect(actions.save(event(saveFields()))).resolves.toMatchObject({
				status,
				data: { message },
			});
		}
	});

	it('clears with the displayed version and maps domain errors', async () => {
		await expect(actions.clear(event({ episodeId, expectedVersion: '2' }))).rejects.toMatchObject({
			status: 303,
			location: `/app/color?episodeId=${episodeId}&cleared=5`,
		});
		expect(color.clearColorGrade).toHaveBeenCalledWith(
			expect.objectContaining({ episodeId, expectedVersion: 2 }),
		);
		color.clearColorGrade.mockRejectedValue(
			new color.ColorGradeError(409, 'COLOR_ALREADY_CLEAR', 'Nada para remover.'),
		);
		await expect(actions.clear(event({ episodeId, expectedVersion: '3' }))).resolves.toMatchObject({
			status: 409,
			data: { message: 'Nada para remover.' },
		});
	});
});
