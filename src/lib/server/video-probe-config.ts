import type { AppConfig } from './config.js';
import { getAppConfig } from './config.js';
import { FfprobeVideoProbe, FixtureVideoProbe, type VideoProbe } from './video-probe.js';

let cachedProbe: VideoProbe | null | undefined;

export function getVideoProbe(config: AppConfig = getAppConfig()): VideoProbe | null {
	if (cachedProbe !== undefined) return cachedProbe;
	if (config.videoProbeDriver === 'ffprobe') cachedProbe = new FfprobeVideoProbe();
	else if (config.videoProbeDriver === 'fixture')
		cachedProbe = import.meta.env.DEV ? new FixtureVideoProbe() : null;
	else cachedProbe = null;
	return cachedProbe;
}

export function resetVideoProbeForTest(): void {
	cachedProbe = undefined;
}
