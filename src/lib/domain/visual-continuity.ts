import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import type { ColorStats } from './color-quality.js';
import { normalizeIdentityText, selectIdentityLook } from './character-identity.js';
import type { CharacterIdentityProfile } from '#lib/schemas/character-identity.js';
import type {
	ContinuityFrame,
	ContinuityObservation,
	VisualContinuityDecision,
	VisualContinuityReport,
} from '#lib/schemas/visual-continuity.js';

export interface VisualSceneInput {
	id: string;
	sceneIndex: number;
	characterNotes: string;
	visualDescription: string;
	location: string;
	lightingNotes: string;
	transition: string;
	startFrameAssetId: string | null;
	endFrameAssetId: string | null;
}

export interface VisualCharacterInput {
	id: string;
	name: string;
	version: number;
	profile: CharacterIdentityProfile | null;
}

export interface VisualContinuityInput {
	episodeId: string;
	seriesId: string;
	episodeNumber: number;
	episodeRevisionNumber: number | null;
	generatedAt: string;
	scenes: VisualSceneInput[];
	characters: VisualCharacterInput[];
	frameStats: Record<string, ColorStats | null | undefined>;
	previous?: VisualContinuityReport | null;
}

const LABELS = {
	wardrobe: ['figurino', 'vestuario', 'vestuário', 'wardrobe'],
	hair: ['cabelo', 'hair'],
	location: ['local', 'locacao', 'locação', 'location'],
	time: ['tempo', 'time'],
} as const;

function stableObservationId(parts: string[]): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (const character of parts.join('|')) {
		const code = character.codePointAt(0) ?? 0;
		first = Math.imul(first ^ code, 16_777_619);
		second = Math.imul(second ^ code, 2_246_822_519);
	}
	return `obs_${(first >>> 0).toString(16).padStart(8, '0')}${((second >>> 16) >>> 0)
		.toString(16)
		.padStart(4, '0')}`;
}

function extractLabeledNote(text: string, labels: readonly string[]): string | null {
	for (const label of labels) {
		const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const match = new RegExp(`(?:^|[\\n.])\\s*${escaped}\\s*:\\s*([^\\n]+)`, 'i').exec(text);
		if (match?.[1]?.trim()) return match[1].trim();
	}
	return null;
}

function containsCharacter(text: string, name: string, aliases: string[]): boolean {
	const haystack = ` ${normalizeIdentityText(text)} `;
	return [name, ...aliases].some((candidate) => {
		const normalized = normalizeIdentityText(candidate);
		return normalized.length > 0 && haystack.includes(` ${normalized} `);
	});
}

function textMatches(expected: string, observed: string): boolean {
	if (!expected || !observed) return true;
	const left = normalizeIdentityText(expected);
	const right = normalizeIdentityText(observed);
	return left.includes(right) || right.includes(left);
}

function truncate(value: string, max = 500): string {
	return value.trim().slice(0, max);
}

function roundMetric(value: number): number {
	return Math.round(value * 1_000) / 1_000;
}

function roundStats(stats: ColorStats): ColorStats {
	return {
		...stats,
		meanLuma: roundMetric(stats.meanLuma),
		p05Luma: roundMetric(stats.p05Luma),
		p95Luma: roundMetric(stats.p95Luma),
		lowClipPct: roundMetric(stats.lowClipPct),
		highClipPct: roundMetric(stats.highClipPct),
		meanSaturation: roundMetric(stats.meanSaturation),
	};
}

function addObservation(
	observations: ContinuityObservation[],
	observation: Omit<ContinuityObservation, 'decisionNote' | 'decidedAt' | 'status'> & {
		status?: ContinuityObservation['status'];
	},
): void {
	observations.push({
		...observation,
		status: observation.status ?? 'NEEDS_REVIEW',
		decisionNote: '',
		decidedAt: null,
	});
}

function frameStatsFor(
	scene: VisualSceneInput,
	stats: Record<string, ColorStats | null | undefined>,
): { assetId: string; stats: ColorStats } | null {
	for (const assetId of [scene.startFrameAssetId, scene.endFrameAssetId]) {
		if (!assetId) continue;
		const value = stats[assetId];
		if (value) return { assetId, stats: value };
	}
	return null;
}

function buildObservations(input: VisualContinuityInput): {
	observations: ContinuityObservation[];
	frames: ContinuityFrame[];
	limitations: string[];
} {
	const observations: ContinuityObservation[] = [];
	const frames: ContinuityFrame[] = [];
	const limitations = new Set<string>([
		'Metadata and pixel statistics are review hints, not semantic recognition or automatic failure.',
		'Only linked start/end frames are sampled; no paid vision provider is used.',
	]);
	const scenes = [...input.scenes].sort((left, right) => left.sceneIndex - right.sceneIndex);
	const profiles = input.characters.filter(
		(character): character is VisualCharacterInput & { profile: CharacterIdentityProfile } =>
			Boolean(character.profile),
	);
	for (const character of input.characters)
		if (!character.profile)
			limitations.add(`${character.name} has no identity profile; scenes stay unflagged.`);
	for (const character of profiles)
		if (!character.profile.references.length)
			limitations.add(`${character.name} has no linked reference image.`);
	if (!profiles.length) limitations.add('No character identity profile was available.');

	let previous: VisualSceneInput | null = null;
	for (const scene of scenes) {
		if (scene.startFrameAssetId) {
			const stats = input.frameStats[scene.startFrameAssetId] ?? null;
			frames.push({
				sceneId: scene.id,
				sceneIndex: scene.sceneIndex,
				role: 'START',
				assetId: scene.startFrameAssetId,
				stats: stats ? roundStats(stats) : null,
			});
		}
		if (scene.endFrameAssetId) {
			const stats = input.frameStats[scene.endFrameAssetId] ?? null;
			frames.push({
				sceneId: scene.id,
				sceneIndex: scene.sceneIndex,
				role: 'END',
				assetId: scene.endFrameAssetId,
				stats: stats ? roundStats(stats) : null,
			});
		}
		if (!scene.startFrameAssetId && !scene.endFrameAssetId) {
			addObservation(observations, {
				id: stableObservationId([scene.id, 'FRAME', 'missing']),
				sceneId: scene.id,
				sceneIndex: scene.sceneIndex,
				characterId: null,
				characterName: '',
				entityType: 'FRAME',
				attribute: 'frame',
				expected: 'At least one READY start or end frame linked to the scene.',
				observed: 'No frame is linked to this scene.',
				method: 'METADATA',
				confidence: 'HIGH',
				frameAssetId: null,
				evidence: 'scenes.start_frame_asset_id and end_frame_asset_id are empty.',
			});
		}

		const wardrobe = extractLabeledNote(scene.characterNotes, LABELS.wardrobe);
		const hair = extractLabeledNote(scene.characterNotes, LABELS.hair);
		for (const character of profiles) {
			if (!containsCharacter(scene.characterNotes, character.name, character.profile.aliases))
				continue;
			const look = selectIdentityLook(character.profile, input.episodeNumber);
			const expectedWardrobe = look?.wardrobe || character.profile.visualTraits.wardrobe;
			const expectedHair = look?.hair || character.profile.visualTraits.hair;
			for (const [attribute, note, expected] of [
				['wardrobe', wardrobe, expectedWardrobe],
				['hair', hair, expectedHair],
			] as const) {
				if (!note || !expected || textMatches(expected, note)) continue;
				addObservation(observations, {
					id: stableObservationId([scene.id, character.id, attribute, note]),
					sceneId: scene.id,
					sceneIndex: scene.sceneIndex,
					characterId: character.id,
					characterName: character.name,
					entityType: 'CHARACTER',
					attribute,
					expected: truncate(look ? `${expected} (look "${look.label}")` : expected),
					observed: truncate(note),
					method: 'METADATA',
					confidence: 'MEDIUM',
					frameAssetId: scene.startFrameAssetId ?? scene.endFrameAssetId,
					evidence: `Profile v${character.version}; deterministic text comparison (${attribute}).`,
				});
			}
		}

		if (previous) {
			const previousLocation = previous.location.trim();
			const currentLocation = scene.location.trim();
			if (
				previousLocation &&
				currentLocation &&
				normalizeIdentityText(previousLocation) !== normalizeIdentityText(currentLocation) &&
				scene.transition === 'cut'
			) {
				addObservation(observations, {
					id: stableObservationId([scene.id, 'LOCATION', previousLocation, currentLocation]),
					sceneId: scene.id,
					sceneIndex: scene.sceneIndex,
					characterId: null,
					characterName: '',
					entityType: 'LOCATION',
					attribute: 'location',
					expected: `Location consistent with scene ${previous.sceneIndex} or an explicit transition.`,
					observed: truncate(`${previousLocation} → ${currentLocation}`),
					method: 'METADATA',
					confidence: 'LOW',
					frameAssetId: scene.startFrameAssetId ?? scene.endFrameAssetId,
					evidence: 'Adjacent scenes declare different locations with a cut transition.',
				});
			}
			const previousTime = extractLabeledNote(previous.characterNotes, LABELS.time);
			const currentTime = extractLabeledNote(scene.characterNotes, LABELS.time);
			if (
				previousTime &&
				currentTime &&
				normalizeIdentityText(previousTime) !== normalizeIdentityText(currentTime)
			) {
				addObservation(observations, {
					id: stableObservationId([scene.id, 'TIME', previousTime, currentTime]),
					sceneId: scene.id,
					sceneIndex: scene.sceneIndex,
					characterId: null,
					characterName: '',
					entityType: 'TIME',
					attribute: 'time',
					expected: `Time consistent with scene ${previous.sceneIndex} or a deliberate ellipsis.`,
					observed: truncate(`${previousTime} → ${currentTime}`),
					method: 'METADATA',
					confidence: 'LOW',
					frameAssetId: scene.startFrameAssetId ?? scene.endFrameAssetId,
					evidence: 'Adjacent scenes declare different labeled times.',
				});
			}
			const previousFrame = frameStatsFor(previous, input.frameStats);
			const currentFrame = frameStatsFor(scene, input.frameStats);
			if (previousFrame && currentFrame) {
				const lumaDelta = Math.abs(currentFrame.stats.meanLuma - previousFrame.stats.meanLuma);
				const saturationDelta = Math.abs(
					currentFrame.stats.meanSaturation - previousFrame.stats.meanSaturation,
				);
				if (lumaDelta >= 35 || saturationDelta >= 30) {
					addObservation(observations, {
						id: stableObservationId([
							scene.id,
							'LIGHTING',
							String(Math.round(lumaDelta)),
							String(Math.round(saturationDelta)),
						]),
						sceneId: scene.id,
						sceneIndex: scene.sceneIndex,
						characterId: null,
						characterName: '',
						entityType: 'LIGHTING',
						attribute: 'lighting',
						expected: `Frame within 35 luma and 30 saturation points of scene ${previous.sceneIndex}.`,
						observed: truncate(
							`Δluma ${lumaDelta.toFixed(1)}; Δsaturation ${saturationDelta.toFixed(1)}`,
						),
						method: 'PIXEL_STATS',
						confidence: lumaDelta >= 35 && saturationDelta >= 30 ? 'MEDIUM' : 'LOW',
						frameAssetId: currentFrame.assetId,
						evidence: 'Sampled RGB statistics from linked private frames.',
					});
				}
			}
		}
		previous = scene;
	}
	const unsampled = frames.filter((frame) => !frame.stats).length;
	if (unsampled > 0)
		limitations.add(
			`${unsampled} linked frame(s) could not be sampled; lighting checks were skipped for them.`,
		);
	if (!frames.length) limitations.add('No linked start/end frames were available for sampling.');
	return { observations, frames, limitations: [...limitations] };
}

export function summarizeContinuityReport(
	observations: ContinuityObservation[],
): VisualContinuityReport['summary'] {
	const count = (status: ContinuityObservation['status']) =>
		observations.filter((observation) => observation.status === status).length;
	return {
		total: observations.length,
		needsReview: count('NEEDS_REVIEW'),
		accepted: count('ACCEPTED'),
		exceptions: count('EXCEPTION'),
		blocking: count('BLOCKING'),
		resolved: count('RESOLVED'),
		unknown: observations.filter((observation) => observation.confidence === 'UNKNOWN').length,
	};
}

export function continuityReportStatus(
	summary: VisualContinuityReport['summary'],
): VisualContinuityReport['status'] {
	if (summary.blocking > 0) return 'BLOCKING';
	if (summary.needsReview > 0 || summary.total === 0) return 'NEEDS_REVIEW';
	return 'ACCEPTED';
}

function rebuildReport(
	report: VisualContinuityReport,
	observations: ContinuityObservation[],
): VisualContinuityReport {
	const summary = summarizeContinuityReport(observations);
	return {
		...report,
		observations,
		summary,
		status: continuityReportStatus(summary),
	};
}

/** Re-applies owner decisions to a freshly generated report by stable observation id. */
export function mergePreviousDecisions(
	report: VisualContinuityReport,
	previous: VisualContinuityReport | null | undefined,
): VisualContinuityReport {
	if (!previous) return report;
	const keyFor = (observation: ContinuityObservation) =>
		`${observation.sceneId}|${observation.entityType}|${observation.attribute}|${observation.characterId ?? ''}`;
	const decisions = new Map(
		previous.observations.map((observation) => [observation.id, observation] as const),
	);
	const decisionsByKey = new Map(
		previous.observations.map((observation) => [keyFor(observation), observation] as const),
	);
	const observations = report.observations.map((observation) => {
		const decision = decisions.get(observation.id) ?? decisionsByKey.get(keyFor(observation));
		if (!decision || (decision.status === 'NEEDS_REVIEW' && !decision.decisionNote))
			return observation;
		return {
			...observation,
			status: decision.status,
			decisionNote: decision.decisionNote,
			decidedAt: decision.decidedAt,
		};
	});
	return rebuildReport(report, observations);
}

export function applyContinuityDecision(
	report: VisualContinuityReport,
	decision: VisualContinuityDecision,
	decidedAt = new Date().toISOString(),
): VisualContinuityReport {
	const index = report.observations.findIndex(
		(observation) => observation.id === decision.observationId,
	);
	if (index < 0) throw new Error('continuity_observation_not_found');
	const note = decision.rationale.trim();
	const decisionNote = decision.action === 'REGENERATE' ? `[REGENERATE] ${note}`.trim() : note;
	const observations = report.observations.map((observation, observationIndex) =>
		observationIndex === index
			? {
					...observation,
					status: decision.status,
					decisionNote: truncate(decisionNote),
					decidedAt,
				}
			: observation,
	);
	return rebuildReport(report, observations);
}

export function visualContinuityReportHash(report: VisualContinuityReport): string {
	return createHash('sha256').update(canonicalJson(report)).digest('hex');
}

function capLimitations(values: string[]): string[] {
	const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
	if (unique.length <= 10) return unique;
	return [...unique.slice(0, 9), `Additional limitations omitted (${unique.length - 9}).`];
}

function capObservations(observations: ContinuityObservation[]): ContinuityObservation[] {
	if (observations.length <= 200) return observations;
	const priority = (status: ContinuityObservation['status']): number =>
		status === 'BLOCKING'
			? 0
			: status === 'NEEDS_REVIEW'
				? 1
				: status === 'EXCEPTION'
					? 2
					: status === 'ACCEPTED'
						? 3
						: 4;
	const kept = [...observations]
		.sort(
			(left, right) =>
				priority(left.status) - priority(right.status) ||
				left.sceneIndex - right.sceneIndex ||
				left.id.localeCompare(right.id),
		)
		.slice(0, 200);
	return kept.sort(
		(left, right) => left.sceneIndex - right.sceneIndex || left.id.localeCompare(right.id),
	);
}

export function buildVisualContinuityReport(input: VisualContinuityInput): VisualContinuityReport {
	const { observations, frames: rawFrames, limitations } = buildObservations(input);
	const profileList = input.characters
		.filter((character) => character.profile)
		.map((character) => ({
			characterId: character.id,
			name: character.name,
			version: character.version,
		}))
		.sort(
			(left, right) =>
				left.name.localeCompare(right.name) || left.characterId.localeCompare(right.characterId),
		);
	const extraLimitations: string[] = [];
	if (profileList.length > 60)
		extraLimitations.push(
			`Only the first 60 of ${profileList.length} profiles are listed in this report.`,
		);
	if (rawFrames.length > 120)
		extraLimitations.push(`Only the first 120 of ${rawFrames.length} sampled frames are listed.`);
	const report: VisualContinuityReport = {
		schemaVersion: 1,
		episodeId: input.episodeId,
		seriesId: input.seriesId,
		episodeNumber: input.episodeNumber,
		episodeRevisionNumber: input.episodeRevisionNumber,
		generatedAt: input.generatedAt,
		profilesUsed: profileList.slice(0, 60),
		frames: rawFrames.slice(0, 120),
		observations,
		summary: summarizeContinuityReport(observations),
		status: continuityReportStatus(summarizeContinuityReport(observations)),
		limitations,
	};
	const merged = mergePreviousDecisions(report, input.previous);
	const truncated = merged.observations.length > 200;
	if (truncated)
		extraLimitations.push(
			`Report truncated from ${merged.observations.length} to 200 observations; blocking items are preserved first.`,
		);
	const capped = rebuildReport(
		{
			...merged,
			limitations: capLimitations([...merged.limitations, ...extraLimitations]),
		},
		capObservations(merged.observations),
	);
	return capped;
}

export function buildContinuityReportMarkdown(
	report: VisualContinuityReport,
	episodeTitle: string,
): string {
	const lines = [
		`# Visual continuity report — ${episodeTitle}`,
		'',
		`- Status: **${report.status}**`,
		`- Episode: ${report.episodeNumber}`,
		`- Generated: ${report.generatedAt}`,
		`- Observations: ${report.summary.total} (review ${report.summary.needsReview}, accepted ${report.summary.accepted}, exceptions ${report.summary.exceptions}, blocking ${report.summary.blocking})`,
		'',
	];
	for (const observation of report.observations) {
		lines.push(
			`## [${observation.status}] Scene ${observation.sceneIndex} — ${observation.entityType} ${observation.attribute}`,
			'',
			`- Character: ${observation.characterName || '—'}`,
			`- Expected: ${observation.expected}`,
			`- Observed: ${observation.observed}`,
			`- Method: ${observation.method}; confidence: ${observation.confidence}`,
			`- Evidence: ${observation.evidence || '—'}`,
		);
		if (observation.frameAssetId)
			lines.push(`- Frame asset: ${observation.frameAssetId} (owner-only)`);
		if (observation.decisionNote) lines.push(`- Owner decision: ${observation.decisionNote}`);
		lines.push('');
	}
	if (report.limitations.length)
		lines.push('## Limitations', '', ...report.limitations.map((item) => `- ${item}`), '');
	return `${lines.join('\n').trim()}\n`;
}
