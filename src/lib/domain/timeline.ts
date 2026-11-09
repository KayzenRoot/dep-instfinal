export interface SceneTiming {
	index: number;
	startMs: number;
	endMs: number;
}

export function buildSceneTimeline(durationMs: number, sceneLengthMs = 8_000): SceneTiming[] {
	if (!Number.isInteger(durationMs) || durationMs < 90_000 || durationMs > 150_000) {
		throw new RangeError('Episode duration must be between 90 and 150 seconds.');
	}
	if (!Number.isInteger(sceneLengthMs) || sceneLengthMs < 1_000 || sceneLengthMs > 30_000) {
		throw new RangeError('Scene length must be between 1 and 30 seconds.');
	}

	const scenes: SceneTiming[] = [];
	for (let startMs = 0, index = 1; startMs < durationMs; startMs += sceneLengthMs, index += 1) {
		scenes.push({ index, startMs, endMs: Math.min(startMs + sceneLengthMs, durationMs) });
	}
	return scenes;
}

export function formatSrtTime(milliseconds: number): string {
	const value = Math.max(0, Math.floor(milliseconds));
	const hours = Math.floor(value / 3_600_000);
	const minutes = Math.floor((value % 3_600_000) / 60_000);
	const seconds = Math.floor((value % 60_000) / 1_000);
	const millis = value % 1_000;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export interface NarratedScene extends SceneTiming {
	narrationPtBr: string;
}

export function buildSrt(scenes: NarratedScene[]): string {
	let cue = 0;
	return (
		scenes
			.filter((scene) => scene.narrationPtBr.trim().length > 0)
			.map((scene) => {
				cue += 1;
				return `${cue}\n${formatSrtTime(scene.startMs)} --> ${formatSrtTime(scene.endMs)}\n${scene.narrationPtBr.trim()}`;
			})
			.join('\n\n') + (cue ? '\n' : '')
	);
}

export function csvCell(value: unknown): string {
	const text = value === null || value === undefined ? '' : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
