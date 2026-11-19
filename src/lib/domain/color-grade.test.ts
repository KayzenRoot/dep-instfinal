import { describe, expect, it } from 'vitest';
import {
	COLOR_PRESET_LIST,
	buildColorFilter,
	colorPreviewCss,
	effectiveColorStrength,
} from './color-grade.js';
import type { ColorGrade } from '#lib/schemas/color-grade.js';

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

describe('color presets', () => {
	it('ships versioned, distinct presets and a neutral no-op', () => {
		expect(COLOR_PRESET_LIST.map((preset) => preset.id)).toEqual([
			'neutral',
			'vhs_1987',
			'police_archive',
			'cctv',
			'cursed_tape',
		]);
		expect(new Set(COLOR_PRESET_LIST.map((preset) => preset.description)).size).toBe(5);
		expect(buildColorFilter(grade({ presetId: 'neutral' }), clipA)).toBeNull();
	});

	it('scales the filter with global strength and per-clip overrides', () => {
		const full = buildColorFilter(grade({ strength: 100 }), clipA);
		const half = buildColorFilter(grade({ strength: 50 }), clipA);
		expect(full).toContain('eq=brightness=0.020');
		expect(half).toContain('eq=brightness=0.010');
		expect(half).not.toBe(full);
		expect(buildColorFilter(grade({ strength: 0 }), clipA)).toBeNull();
	});

	it('supports excluding or attenuating a single scene', () => {
		const value = grade({
			overrides: [
				{ clipId: clipA, strength: 20, exclude: false },
				{ clipId: clipB, strength: 80, exclude: true },
			],
		});
		expect(effectiveColorStrength(value, clipA)).toBe(20);
		expect(effectiveColorStrength(value, clipB)).toBe(0);
		expect(buildColorFilter(value, clipB)).toBeNull();
		expect(buildColorFilter(value, clipA)).toContain('eq=brightness=0.004');
		expect(colorPreviewCss(value)).toContain('brightness');
	});
});
