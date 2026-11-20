import {
	STYLE_BIBLE_VERSION,
	styleConfigSchema,
	type StyleConfig,
	type StyleOverride,
	type StyleSnapshot,
} from '#lib/schemas/style-bible.js';

export class StyleBibleError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'StyleBibleError';
	}
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = styleConfigSchema.parse({
	schemaVersion: STYLE_BIBLE_VERSION,
});

export const STYLE_FIELDS = Object.keys(DEFAULT_STYLE_CONFIG).filter(
	(field): field is keyof StyleConfig => field !== 'schemaVersion',
);

export interface StyleLayer {
	source: 'SERIES' | 'SEASON' | 'EPISODE' | 'SCENE';
	config: StyleOverride | null;
}

export interface ResolvedStyle {
	config: StyleConfig;
	sources: Record<string, 'DEFAULT' | 'SERIES' | 'SEASON' | 'EPISODE' | 'SCENE'>;
}

export function resolveStyle(layers: StyleLayer[]): ResolvedStyle {
	const config: Record<string, unknown> = { ...DEFAULT_STYLE_CONFIG };
	const sources: Record<string, 'DEFAULT' | 'SERIES' | 'SEASON' | 'EPISODE' | 'SCENE'> = {};
	for (const field of STYLE_FIELDS) sources[field] = 'DEFAULT';
	for (const layer of layers) {
		if (!layer.config) continue;
		for (const field of STYLE_FIELDS) {
			const value = layer.config[field];
			if (value !== undefined) {
				config[field] = value;
				sources[field] = layer.source;
			}
		}
	}
	return { config: styleConfigSchema.parse(config), sources };
}

export function withdrawInvalidSfx(
	config: StyleConfig,
	validIds: ReadonlySet<string>,
): StyleConfig {
	const kept = config.sfxAssetIds.filter((id) => validIds.has(id));
	if (kept.length === config.sfxAssetIds.length) return config;
	return { ...config, sfxAssetIds: kept };
}

export interface StyleSnapshotDrift {
	stale: boolean;
	capturedRevision: number | null;
	currentRevision: number | null;
	capturedHash: string | null;
	currentHash: string | null;
	configChanged: boolean;
	scenesChanged: boolean;
}

export function styleSnapshotDrift(
	captured: StyleSnapshot,
	current: StyleSnapshot,
): StyleSnapshotDrift {
	const configChanged = JSON.stringify(captured.config) !== JSON.stringify(current.config);
	const scenesChanged =
		JSON.stringify(captured.scenes ?? []) !== JSON.stringify(current.scenes ?? []);
	return {
		stale:
			captured.presetRevision !== current.presetRevision ||
			captured.presetHash !== current.presetHash ||
			configChanged ||
			scenesChanged,
		capturedRevision: captured.presetRevision,
		currentRevision: current.presetRevision,
		capturedHash: captured.presetHash,
		currentHash: current.presetHash,
		configChanged,
		scenesChanged,
	};
}

export function styleFontStack(fontFamily: StyleConfig['fontFamily']): string {
	if (fontFamily === 'serif') return 'Georgia, "Times New Roman", serif';
	if (fontFamily === 'mono') return '"Courier New", Consolas, monospace';
	if (fontFamily === 'display') return 'Impact, "Arial Black", sans-serif';
	return 'Arial, "DejaVu Sans", sans-serif';
}
