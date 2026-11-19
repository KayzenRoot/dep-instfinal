import { describe, expect, it } from 'vitest';
import { colorGradeSchema, colorOverrideSchema } from './color-grade.js';

const clipId = '11111111-1111-4111-8111-111111111111';

describe('colorGradeSchema', () => {
	it('accepts the documented bounds and nullable reference', () => {
		expect(
			colorGradeSchema.safeParse({
				presetId: 'cursed_tape',
				presetVersion: 1,
				strength: 0,
				referenceClipId: null,
				overrides: [],
			}).success,
		).toBe(true);
		expect(
			colorGradeSchema.safeParse({
				presetId: 'cursed_tape',
				presetVersion: 1,
				strength: 100,
				referenceClipId: clipId,
				overrides: [{ clipId, strength: 100, exclude: true }],
			}).success,
		).toBe(true);
	});

	it('rejects unknown presets, out-of-range strength and foreign fields', () => {
		const base = {
			presetId: 'cursed_tape',
			presetVersion: 1,
			strength: 80,
			referenceClipId: null,
			overrides: [],
		};
		expect(colorGradeSchema.safeParse({ ...base, presetId: 'sepia' }).success).toBe(false);
		expect(colorGradeSchema.safeParse({ ...base, presetVersion: 2 }).success).toBe(false);
		expect(colorGradeSchema.safeParse({ ...base, strength: 150 }).success).toBe(false);
		expect(colorGradeSchema.safeParse({ ...base, strength: 50.5 }).success).toBe(false);
		expect(colorGradeSchema.safeParse({ ...base, referenceClipId: 'not-a-uuid' }).success).toBe(
			false,
		);
	});

	it('validates each override and the 60-scene ceiling', () => {
		expect(colorOverrideSchema.safeParse({ clipId, strength: 50, exclude: false }).success).toBe(
			true,
		);
		expect(colorOverrideSchema.safeParse({ clipId, strength: 101, exclude: false }).success).toBe(
			false,
		);
		expect(
			colorOverrideSchema.safeParse({ clipId: 'x', strength: 50, exclude: false }).success,
		).toBe(false);
		const overrides = Array.from({ length: 61 }, (_, index) => ({
			clipId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			strength: 50,
			exclude: false,
		}));
		expect(
			colorGradeSchema.safeParse({
				presetId: 'cctv',
				presetVersion: 1,
				strength: 50,
				referenceClipId: null,
				overrides,
			}).success,
		).toBe(false);
	});
});
