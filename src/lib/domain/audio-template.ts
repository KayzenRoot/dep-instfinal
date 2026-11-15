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
	const preImpactEnd = Math.max(0, impactStart - 1_500);
	const postImpactStart = Math.min(input.durationMs, impactStart + impactDuration);
	const postImpactDuration = input.durationMs - postImpactStart;
	const impactFadeIn = Math.min(50, Math.floor(impactDuration / 4));
	const impactFadeOut = Math.min(400, impactDuration - impactFadeIn);
	const events: EditPlanAudioEvent[] = [];
	if (preImpactEnd >= 100)
		events.push({
			id: crypto.randomUUID(),
			assetId: ambience.id,
			kind: ambience.kind,
			startMs: 0,
			durationMs: preImpactEnd,
			sourceInMs: 0,
			gainDb: -24,
			fadeInMs: Math.min(1_500, Math.floor(preImpactEnd / 4)),
			fadeOutMs: Math.min(1_000, preImpactEnd - Math.min(1_500, Math.floor(preImpactEnd / 4))),
			pan: 0,
			distance: 0.8,
			loop: true,
			ducking: true,
			spatialPreset: 'corridor',
			spatialMode: 'binaural_simulated',
		});
	events.push({
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
		distance: 0.2,
		loop: false,
		ducking: false,
		spatialPreset: 'steps-behind',
		spatialMode: 'binaural_simulated',
	});
	if (postImpactDuration >= 100)
		events.push({
			id: crypto.randomUUID(),
			assetId: ambience.id,
			kind: ambience.kind,
			startMs: postImpactStart,
			durationMs: postImpactDuration,
			sourceInMs: 0,
			gainDb: -28,
			fadeInMs: Math.min(1_500, Math.floor(postImpactDuration / 4)),
			fadeOutMs: Math.min(2_000, postImpactDuration - 100),
			pan: 0,
			distance: 0.8,
			loop: true,
			ducking: true,
			spatialPreset: 'corridor',
			spatialMode: 'binaural_simulated',
		});
	return { masterGainDb: 0, events };
}
