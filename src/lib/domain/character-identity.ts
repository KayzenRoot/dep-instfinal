import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import type {
	CharacterIdentityProfile,
	IdentityLook,
	IdentityReference,
} from '#lib/schemas/character-identity.js';

export interface CharacterIdentityRecord {
	characterId: string;
	name: string;
	version: number;
	profile: CharacterIdentityProfile;
}

export interface CharacterIdentityCandidate {
	characterId: string;
	name: string;
	version: number;
	profile: CharacterIdentityProfile | null;
}

export interface SceneIdentityInput {
	id: string;
	sceneIndex: number;
	characterNotes: string;
	visualDescription: string;
	startFramePromptEn: string;
}

export interface IdentityPromptRow {
	sceneId: string;
	sceneIndex: number;
	characterIds: string[];
	characterNames: string[];
	scenePrompt: string;
	anchor: string;
	checklist: string[];
	composedPrompt: string;
}

export interface IdentityPromptBundle {
	rows: IdentityPromptRow[];
	missingProfiles: Array<{ characterId: string; name: string }>;
	unmatchedScenes: number[];
	limitations: string[];
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable JSON used for hashes and version fingerprints. */
export function canonicalIdentityJson(value: unknown): string {
	return canonicalJson(value);
}

export function identityProfileHash(profile: CharacterIdentityProfile): string {
	return createHash('sha256').update(canonicalJson(profile)).digest('hex');
}

export function normalizeIdentityText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function slugifyIdentityLook(label: string, index: number): string {
	const slug = normalizeIdentityText(label)
		.replace(/\s+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `${slug.slice(0, 34) || 'look'}-${index + 1}`;
}

function containsName(text: string, name: string): boolean {
	const normalizedName = normalizeIdentityText(name);
	if (!normalizedName) return false;
	return ` ${normalizeIdentityText(text)} `.includes(` ${normalizedName} `);
}

export function selectIdentityLook(
	profile: CharacterIdentityProfile,
	episodeNumber: number,
): IdentityLook | null {
	const matches = profile.looks.filter(
		(look) =>
			look.appliesFromEpisode <= episodeNumber &&
			(look.appliesToEpisode === null || look.appliesToEpisode >= episodeNumber),
	);
	matches.sort(
		(left, right) =>
			left.appliesFromEpisode - right.appliesFromEpisode || compareText(left.id, right.id),
	);
	return matches.at(-1) ?? null;
}

function effectiveTraits(profile: CharacterIdentityProfile, look: IdentityLook | null) {
	return {
		...profile.visualTraits,
		hair: look?.hair || profile.visualTraits.hair,
		wardrobe: look?.wardrobe || profile.visualTraits.wardrobe,
	};
}

function describeLookRange(look: IdentityLook): string {
	return look.appliesToEpisode === null
		? `from episode ${look.appliesFromEpisode} onward`
		: `episodes ${look.appliesFromEpisode}–${look.appliesToEpisode}`;
}

/** Deterministic English anchor for Flow prompts. Trait values are owner-authored. */
export function buildIdentityAnchor(
	profile: CharacterIdentityProfile,
	characterName: string,
	episodeNumber: number,
): string {
	if (profile.anchorOverrideEn.trim()) return profile.anchorOverrideEn.trim();
	const look = selectIdentityLook(profile, episodeNumber);
	const traits = effectiveTraits(profile, look);
	const pieces = [
		traits.hair && `hair ${traits.hair}`,
		traits.wardrobe && `wardrobe ${traits.wardrobe}`,
		traits.silhouette && `silhouette ${traits.silhouette}`,
		traits.marks && `distinguishing marks ${traits.marks}`,
		traits.accessories && `accessories ${traits.accessories}`,
		profile.immutableAccessories.length &&
			`immutable items ${profile.immutableAccessories.join(', ')}`,
		profile.palette && `palette ${profile.palette}`,
		profile.lighting && `preferred lighting ${profile.lighting}`,
	].filter(Boolean);
	return `${characterName}: ${pieces.join('; ')}.`.replace(/\s+/g, ' ').trim();
}

/** Deterministic English checklist for scene generation and manual review. */
export function buildContinuityChecklist(
	profile: CharacterIdentityProfile,
	characterName: string,
	episodeNumber: number,
): string[] {
	const look = selectIdentityLook(profile, episodeNumber);
	const traits = effectiveTraits(profile, look);
	const checklist: string[] = [];
	if (traits.hair) checklist.push(`Keep ${characterName}'s hair consistent: ${traits.hair}.`);
	if (traits.wardrobe)
		checklist.push(`Keep ${characterName}'s wardrobe consistent: ${traits.wardrobe}.`);
	if (traits.silhouette)
		checklist.push(`Keep ${characterName}'s silhouette consistent: ${traits.silhouette}.`);
	if (traits.marks) checklist.push(`Keep distinguishing marks visible: ${traits.marks}.`);
	if (profile.immutableAccessories.length)
		checklist.push(`Never remove immutable items: ${profile.immutableAccessories.join(', ')}.`);
	if (look)
		checklist.push(
			`Wardrobe look "${look.label}" is valid ${describeLookRange(look)}; any deliberate change needs an owner exception.`,
		);
	if (profile.mutableAccessories.length)
		checklist.push(
			`These items may change only with an explicit scene note: ${profile.mutableAccessories.join(', ')}.`,
		);
	if (profile.negativePrompts.length)
		checklist.push(`Do not include: ${profile.negativePrompts.join(', ')}.`);
	return checklist;
}

export function composeIdentityPrompt(
	scenePrompt: string,
	anchor: string,
	checklist: string[],
	negativePrompts: string[],
): string {
	const sections = [scenePrompt.trim()];
	if (anchor) sections.push(`Character anchor: ${anchor}`);
	if (checklist.length) sections.push(`Continuity checklist:\n- ${checklist.join('\n- ')}`);
	if (negativePrompts.length) sections.push(`Negative constraints: ${negativePrompts.join(', ')}.`);
	return sections.filter(Boolean).join('\n\n');
}

/**
 * Matches characters by whole name/alias in scene notes. This is deliberately
 * conservative: text matching is a hint, never semantic recognition.
 */
export function buildSceneIdentityPrompts(
	scenes: SceneIdentityInput[],
	characters: CharacterIdentityCandidate[],
	episodeNumber: number,
): IdentityPromptBundle {
	const rows: IdentityPromptRow[] = [];
	const unmatchedScenes: number[] = [];
	const missingProfiles = new Map<string, { characterId: string; name: string }>();
	const limitations = [
		'Character matching uses exact names/aliases in scene notes; ambiguous or unmentioned characters stay for manual review.',
		'Generated anchors and checklists do not modify the existing scene prompts or canon.',
	];
	for (const scene of [...scenes].sort((left, right) => left.sceneIndex - right.sceneIndex)) {
		const haystack = [scene.characterNotes, scene.visualDescription, scene.startFramePromptEn].join(
			'\n',
		);
		const matches = characters.filter(
			(character) =>
				containsName(haystack, character.name) ||
				(character.profile?.aliases ?? []).some((alias) => containsName(haystack, alias)),
		);
		if (!matches.length) {
			unmatchedScenes.push(scene.sceneIndex);
			continue;
		}
		const anchors: string[] = [];
		const checklist: string[] = [];
		const characterIds: string[] = [];
		const characterNames: string[] = [];
		for (const character of matches) {
			if (!character.profile) {
				missingProfiles.set(character.characterId, {
					characterId: character.characterId,
					name: character.name,
				});
				continue;
			}
			const anchor = buildIdentityAnchor(character.profile, character.name, episodeNumber);
			anchors.push(anchor);
			checklist.push(...buildContinuityChecklist(character.profile, character.name, episodeNumber));
			characterIds.push(character.characterId);
			characterNames.push(character.name);
		}
		if (!characterIds.length) continue;
		const anchor = anchors.join(' ');
		const negativePrompts = [
			...new Set(matches.flatMap((character) => character.profile?.negativePrompts ?? [])),
		];
		rows.push({
			sceneId: scene.id,
			sceneIndex: scene.sceneIndex,
			characterIds,
			characterNames,
			scenePrompt: scene.startFramePromptEn,
			anchor,
			checklist,
			composedPrompt: composeIdentityPrompt(
				scene.startFramePromptEn,
				anchor,
				checklist,
				negativePrompts,
			),
		});
	}
	return {
		rows,
		missingProfiles: [...missingProfiles.values()],
		unmatchedScenes,
		limitations,
	};
}

export function identityReferenceManifest(references: IdentityReference[]): Array<{
	assetId: string;
	label: string;
	role: IdentityReference['role'];
}> {
	return references.map((reference) => ({
		assetId: reference.assetId,
		label: reference.label,
		role: reference.role,
	}));
}

export function buildIdentityChecklistMarkdown(
	seriesTitle: string,
	characters: CharacterIdentityRecord[],
	episodeNumber: number,
): string {
	const lines = [`# Character identity checklist — ${seriesTitle}`, ''];
	for (const character of characters) {
		const anchor = buildIdentityAnchor(character.profile, character.name, episodeNumber);
		const checklist = buildContinuityChecklist(character.profile, character.name, episodeNumber);
		lines.push(`## ${character.name} (profile v${character.version})`, '');
		if (character.profile.aliases.length)
			lines.push(`Aliases: ${character.profile.aliases.join(', ')}`, '');
		lines.push(`**Anchor:** ${anchor}`, '');
		if (checklist.length) lines.push(...checklist.map((item) => `- ${item}`), '');
		if (character.profile.references.length) {
			lines.push(
				'References (owner-only assets; fetch through the authenticated gallery):',
				...character.profile.references.map(
					(reference) => `- ${reference.label} — asset ${reference.assetId}`,
				),
				'',
			);
		}
	}
	return `${lines.join('\n').trim()}\n`;
}
