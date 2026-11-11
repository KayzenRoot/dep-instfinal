export interface ContinuityCharacter {
	name: string;
	status: string;
}

export interface ContinuityLoreFact {
	title: string;
	status: string;
}

export interface ContinuityWarning {
	code: string;
	label: string;
	excerpt: string;
}

const characterStatuses = new Set(['DECEASED', 'MISSING', 'ARCHIVED']);
const loreStatuses = new Set(['SUPERSEDED', 'ARCHIVED']);

function normalize(value: string): string {
	return value.trim().toLocaleLowerCase('pt-BR');
}

/**
 * Deterministic continuity hints for the author before canon approval. This is
 * deliberately not an automatic rewrite or canon decision: it only points at
 * names/titles that already carry an inactive canonical state and appear in
 * the episode text. The owner still decides and records the review.
 */
export function findContinuityWarnings(input: {
	text: string;
	characters: ContinuityCharacter[];
	loreFacts: ContinuityLoreFact[];
}): ContinuityWarning[] {
	const text = normalize(input.text);
	if (!text) return [];
	const warnings: ContinuityWarning[] = [];
	const seen = new Set<string>();

	for (const character of input.characters) {
		const name = normalize(character.name);
		if (!name || !characterStatuses.has(character.status) || !text.includes(name)) continue;
		const code = `CHARACTER_${character.status}:${name}`;
		if (seen.has(code)) continue;
		seen.add(code);
		warnings.push({
			code,
			label: `O personagem "${character.name}" está ${character.status} e aparece neste episódio. Confirme se há explicação canônica.`,
			excerpt: character.name,
		});
	}

	for (const fact of input.loreFacts) {
		const title = normalize(fact.title);
		if (!title || !loreStatuses.has(fact.status) || !text.includes(title)) continue;
		const code = `LORE_${fact.status}:${title}`;
		if (seen.has(code)) continue;
		seen.add(code);
		warnings.push({
			code,
			label: `O fato canônico "${fact.title}" está ${fact.status} e é referenciado neste episódio. Revise antes de canonizar.`,
			excerpt: fact.title,
		});
	}

	return warnings;
}
