import type { ColorGrade, ColorPresetId } from '#lib/schemas/color-grade.js';

export interface ColorPreset {
	id: ColorPresetId;
	label: string;
	version: 1;
	description: string;
	eq: { brightness: number; contrast: number; saturation: number; gamma: number };
	balance: { rs: number; gs: number; bs: number };
	noise: number;
	vignette: number | null;
}

export const COLOR_PRESETS: Record<ColorPresetId, ColorPreset> = {
	neutral: {
		id: 'neutral',
		label: 'Neutro',
		version: 1,
		description: 'Sem correção cromática.',
		eq: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
		balance: { rs: 0, gs: 0, bs: 0 },
		noise: 0,
		vignette: null,
	},
	vhs_1987: {
		id: 'vhs_1987',
		label: 'VHS 1987',
		version: 1,
		description: 'Contraste contido, saturação quente, ruído e vinheta discretos.',
		eq: { brightness: 0.02, contrast: 1.05, saturation: 1.12, gamma: 1.1 },
		balance: { rs: 0.04, gs: 0, bs: -0.05 },
		noise: 4,
		vignette: 9,
	},
	police_archive: {
		id: 'police_archive',
		label: 'Arquivo policial',
		version: 1,
		description: 'Dessaturado e frio, com sombras abertas e grão leve.',
		eq: { brightness: 0.02, contrast: 1.05, saturation: 0.6, gamma: 1.15 },
		balance: { rs: -0.03, gs: 0.01, bs: 0.06 },
		noise: 3,
		vignette: 9,
	},
	cctv: {
		id: 'cctv',
		label: 'CCTV',
		version: 1,
		description: 'Baixa saturação, contraste contido e ruído de câmera de segurança.',
		eq: { brightness: 0.02, contrast: 1.05, saturation: 0.45, gamma: 1.18 },
		balance: { rs: -0.05, gs: 0.04, bs: -0.01 },
		noise: 6,
		vignette: 9,
	},
	cursed_tape: {
		id: 'cursed_tape',
		label: 'Fita amaldiçoada',
		version: 1,
		description: 'Sombras legíveis, ruído e vinheta de fita, sem apagar detalhes.',
		eq: { brightness: 0.02, contrast: 1.05, saturation: 0.85, gamma: 1.2 },
		balance: { rs: 0.07, gs: -0.02, bs: 0.03 },
		noise: 8,
		vignette: 10,
	},
};

export const COLOR_PRESET_LIST = Object.values(COLOR_PRESETS);

/** Scene indexes are stored 1-based; the fallback follows chronological order. */
export function colorSceneLabel(sceneIndex: number | undefined, fallbackIndex: number): string {
	return sceneIndex === undefined ? `Cena ${fallbackIndex + 1}` : `Cena ${sceneIndex}`;
}

function round(value: number): string {
	return (Math.round(value * 1_000) / 1_000).toFixed(3);
}

export function effectiveColorStrength(grade: ColorGrade, clipId: string): number {
	const override = grade.overrides.find((candidate) => candidate.clipId === clipId);
	if (!override) return grade.strength;
	return override.exclude ? 0 : override.strength;
}

/** Deterministic allowlisted FFmpeg filter for one clip; null means no grading. */
export function buildColorFilter(
	grade: ColorGrade | null | undefined,
	clipId: string,
): string | null {
	if (!grade || grade.presetId === 'neutral') return null;
	const preset = COLOR_PRESETS[grade.presetId];
	const strength = effectiveColorStrength(grade, clipId);
	if (strength <= 0) return null;
	const factor = Math.min(1, Math.max(0, strength / 100));
	const brightness = preset.eq.brightness * factor;
	const contrast = 1 + (preset.eq.contrast - 1) * factor;
	const saturation = 1 + (preset.eq.saturation - 1) * factor;
	const gamma = 1 + (preset.eq.gamma - 1) * factor;
	const filters = [
		`eq=brightness=${round(brightness)}:contrast=${round(contrast)}:saturation=${round(saturation)}:gamma=${round(gamma)}`,
		`colorbalance=rs=${round(preset.balance.rs * factor)}:gs=${round(preset.balance.gs * factor)}:bs=${round(preset.balance.bs * factor)}`,
	];
	if (preset.noise > 0)
		filters.push(
			`noise=alls=${Math.max(0, Math.round(preset.noise * factor))}:allf=t+u:all_seed=1`,
		);
	if (preset.vignette)
		filters.push(`vignette=angle=PI/${round(preset.vignette + (1 - factor) * 6)}`);
	return filters.join(',');
}

export function colorPreviewCss(grade: ColorGrade | null | undefined): string {
	if (!grade || grade.presetId === 'neutral') return 'none';
	const preset = COLOR_PRESETS[grade.presetId];
	const factor = Math.min(1, Math.max(0, grade.strength / 100));
	const brightness = 1 + preset.eq.brightness * factor;
	const contrast = 1 + (preset.eq.contrast - 1) * factor;
	const saturation = 1 + (preset.eq.saturation - 1) * factor;
	const sepia = grade.presetId === 'police_archive' ? 0.15 * factor : 0;
	const hue =
		grade.presetId === 'vhs_1987'
			? -8 * factor
			: grade.presetId === 'cursed_tape'
				? 10 * factor
				: grade.presetId === 'cctv'
					? 18 * factor
					: 0;
	return `brightness(${brightness.toFixed(2)}) contrast(${contrast.toFixed(2)}) saturate(${saturation.toFixed(2)}) sepia(${sepia.toFixed(2)}) hue-rotate(${hue.toFixed(1)}deg)`;
}
