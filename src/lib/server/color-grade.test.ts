import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColorGrade } from '#lib/schemas/color-grade.js';

const planModule = vi.hoisted(() => ({
	loadEditPlan: vi.fn(),
	saveVideoEditPlan: vi.fn(),
}));
vi.mock('./video-edit-plans.js', () => planModule);

import { clearColorGrade, ColorGradeError, saveColorGrade } from './color-grade.js';

const clipA = '11111111-1111-4111-8111-111111111111';
const clipB = '22222222-2222-4222-8222-222222222222';

function grade(overrides: Partial<ColorGrade> = {}): ColorGrade {
	return {
		presetId: 'cursed_tape',
		presetVersion: 1,
		strength: 80,
		referenceClipId: clipA,
		overrides: [],
		...overrides,
	};
}

function storedPlan(color: ColorGrade | null) {
	return {
		plan: {
			id: 'plan-id',
			current_version: 3,
			current_status: 'DRAFT' as const,
			plan: {
				clips: [{ id: clipA }, { id: clipB }],
				...(color ? { color } : {}),
			},
			manifest_hash: 'hash',
			updated_at: '2026-11-19T00:00:00Z',
		},
		versions: [],
	};
}

const baseInput = {
	db: {} as never,
	adminDb: {} as never,
	owner: { id: 'owner-id' } as never,
	episodeId: 'episode-id',
	expectedVersion: 3,
};

describe('saveColorGrade', () => {
	beforeEach(() => {
		planModule.loadEditPlan.mockResolvedValue(storedPlan(null));
		planModule.saveVideoEditPlan.mockResolvedValue(4);
	});

	it('saves the grade against the version the owner opened', async () => {
		await expect(saveColorGrade({ ...baseInput, grade: grade() })).resolves.toBe(4);
		expect(planModule.saveVideoEditPlan).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedVersion: 3,
				plan: expect.objectContaining({ color: grade() }),
			}),
		);
	});

	it('rejects references and overrides that are not in the current plan', async () => {
		await expect(
			saveColorGrade({
				...baseInput,
				grade: grade({ referenceClipId: '33333333-3333-4333-8333-333333333333' }),
			}),
		).rejects.toMatchObject({ status: 400, code: 'COLOR_REFERENCE_UNKNOWN' });
		await expect(
			saveColorGrade({
				...baseInput,
				grade: grade({
					overrides: [
						{ clipId: '44444444-4444-4444-8444-444444444444', strength: 50, exclude: false },
					],
				}),
			}),
		).rejects.toMatchObject({ status: 400, code: 'COLOR_OVERRIDE_UNKNOWN' });
		await expect(
			saveColorGrade({
				...baseInput,
				grade: grade({
					overrides: [
						{ clipId: clipA, strength: 50, exclude: false },
						{ clipId: clipA, strength: 20, exclude: true },
					],
				}),
			}),
		).rejects.toMatchObject({ status: 400, code: 'COLOR_OVERRIDE_DUPLICATE' });
		expect(planModule.saveVideoEditPlan).not.toHaveBeenCalled();
	});

	it('rejects an invalid grade before loading the plan', async () => {
		await expect(
			saveColorGrade({ ...baseInput, grade: grade({ strength: 101 }) }),
		).rejects.toBeInstanceOf(ColorGradeError);
		expect(planModule.loadEditPlan).not.toHaveBeenCalled();
	});

	it('requires a stored plan', async () => {
		planModule.loadEditPlan.mockResolvedValue({ plan: null, versions: [] });
		await expect(saveColorGrade({ ...baseInput, grade: grade() })).rejects.toMatchObject({
			status: 409,
			code: 'COLOR_PLAN_MISSING',
		});
	});
});

describe('clearColorGrade', () => {
	beforeEach(() => {
		planModule.loadEditPlan.mockResolvedValue(storedPlan(grade()));
		planModule.saveVideoEditPlan.mockResolvedValue(9);
	});

	it('removes the color field and keeps the optimistic version', async () => {
		await expect(clearColorGrade(baseInput)).resolves.toBe(9);
		const call = planModule.saveVideoEditPlan.mock.calls[0]?.[0];
		expect(call).toMatchObject({ expectedVersion: 3 });
		expect(call.plan).not.toHaveProperty('color');
	});

	it('refuses to create a version when there is nothing to clear', async () => {
		planModule.loadEditPlan.mockResolvedValue(storedPlan(null));
		await expect(clearColorGrade(baseInput)).rejects.toMatchObject({
			status: 409,
			code: 'COLOR_ALREADY_CLEAR',
		});
		expect(planModule.saveVideoEditPlan).not.toHaveBeenCalled();
	});
});
