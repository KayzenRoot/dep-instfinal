import type { AudioAsset, EditPlanAudioEvent } from '#lib/schemas/audio-library.js';

export class AudioEventError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'AudioEventError';
	}
}

export function isAudioExportable(
	asset: Pick<AudioAsset, 'licenseStatus' | 'commercialAllowed' | 'socialAllowed'>,
): boolean {
	return asset.licenseStatus === 'VERIFIED' && asset.commercialAllowed && asset.socialAllowed;
}

export function assertAudioEventsUsable(
	events: EditPlanAudioEvent[],
	assets: AudioAsset[],
): Map<string, AudioAsset> {
	const byId = new Map(assets.map((asset) => [asset.id, asset]));
	for (const event of events) {
		const asset = byId.get(event.assetId);
		if (!asset)
			throw new AudioEventError('AUDIO_EVENT_ASSET_MISSING', 'Um evento usa áudio inexistente.');
		if (asset.kind !== event.kind)
			throw new AudioEventError(
				'AUDIO_EVENT_KIND_MISMATCH',
				'O tipo do evento não confere com o áudio.',
			);
		if (!isAudioExportable(asset))
			throw new AudioEventError(
				'AUDIO_EVENT_LICENSE_BLOCKED',
				'Um áudio sem licença verificada não pode ser exportado.',
			);
		if (event.sourceInMs >= asset.durationMs)
			throw new AudioEventError(
				'AUDIO_EVENT_SOURCE_RANGE',
				'O offset do áudio excede a duração do asset.',
			);
		if (!event.loop && event.sourceInMs + event.durationMs > asset.durationMs)
			throw new AudioEventError('AUDIO_EVENT_SOURCE_RANGE', 'O evento excede a duração do áudio.');
	}
	return byId;
}
