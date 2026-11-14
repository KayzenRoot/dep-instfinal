import type { AudioAsset, EditPlanAudio, EditPlanAudioEvent } from '#lib/schemas/audio-library.js';

export class AudioTemplateError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'AudioTemplateError';
	}
}

function supports(asset: AudioAsset): boolean {
	return asset.licenseStatus === 'VERIFIED' && asset.commercialAllowed && asset.socialAllowed;
}

/**
 * Basic 120s suspense bed: licensed ambience throughout, an impact near the
 * final beat and a short fade tail. The owner can remove or swap every event.
 */
export function buildSuspenseAudioTemplate(input: {
	durationMs: number;
	assets: AudioAsset[];
	impactAtMs?: number;
}): EditPlanAudio {
	const ambience = input.assets.find(
		(asset) =>
			supports(asset) &&
			(asset.kind === 'AMBIENCE' || asset.kind === 'MUSIC') &&
			asset.tags.some((tag) => ['ambiente', 'drone'].includes(tag)),
	);
	const impact = input.assets.find(
		(asset) =>
			supports(asset) &&
			asset.kind === 'SFX' &&
			asset.tags.some((tag) => ['impacto', 'susto'].includes(tag)),
	);
	if (!ambience)
		throw new AudioTemplateError(
			'AUDIO_TEMPLATE_AMBIENCE_REQUIRED',
			'Importe uma ambiência ou drone com licença verificada.',
		);
	if (!impact)
		throw new AudioTemplateError(
			'AUDIO_TEMPLATE_IMPACT_REQUIRED',
			'Importe um impacto de susto com licença verificada.',
		);
	const impactStart = Math.max(
		0,
		Math.min(input.durationMs - 100, input.impactAtMs ?? Math.max(0, input.durationMs - 15_000)),
	);
	const impactDuration = Math.min(2_500, Math.max(100, impact.durationMs));
	const impactFadeIn = Math.min(50, Math.floor(impactDuration / 4));
	const impactFadeOut = Math.min(400, impactDuration - impactFadeIn);
	const events: EditPlanAudioEvent[] = [
		{
			id: crypto.randomUUID(),
			assetId: ambience.id,
			kind: ambience.kind,
			startMs: 0,
			durationMs: input.durationMs,
			sourceInMs: 0,
			gainDb: -24,
			fadeInMs: 1_500,
			fadeOutMs: 3_000,
			pan: 0,
			loop: true,
			ducking: true,
			spatialPreset: 'corridor',
			spatialMode: 'binaural_simulated',
		},
		{
			id: crypto.randomUUID(),
			assetId: impact.id,
			kind: 'SFX',
			startMs: impactStart,
			durationMs: impactDuration,
			sourceInMs: 0,
			gainDb: -4,
			fadeInMs: impactFadeIn,
			fadeOutMs: impactFadeOut,
			pan: 0,
			loop: false,
			ducking: false,
			spatialPreset: 'steps-behind',
			spatialMode: 'binaural_simulated',
		},
	];
	return { masterGainDb: 0, events };
}
