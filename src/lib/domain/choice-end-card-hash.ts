import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { END_CARD_TEMPLATES, EndCardError } from './choice-end-card.js';
import type { ChoiceEndCardChoice, ChoiceEndCardConfig } from '#lib/schemas/choice-end-card.js';

export const END_CARD_HASH_VERSION = 1;
export const END_CARD_RENDERER_VERSION = 1;

export function choiceSetHash(choices: ChoiceEndCardChoice[]): string {
	return createHash('sha256')
		.update(
			canonicalJson(
				[...choices]
					.sort((left, right) => left.optionKey.localeCompare(right.optionKey))
					.map((choice) => ({
						id: choice.id,
						optionKey: choice.optionKey,
						label: choice.label,
						consequence: choice.consequence,
					})),
			),
		)
		.digest('hex');
}

export function choiceEndCardConfigHash(
	config: ChoiceEndCardConfig,
	choices: ChoiceEndCardChoice[],
	hashVersion = END_CARD_HASH_VERSION,
): string {
	if (hashVersion !== END_CARD_HASH_VERSION)
		throw new EndCardError(
			'END_CARD_HASH_VERSION_UNSUPPORTED',
			'Versão de hash do final A/B não suportada.',
		);
	const template = END_CARD_TEMPLATES[config.templateId];
	return createHash('sha256')
		.update(
			canonicalJson({
				hashVersion: END_CARD_HASH_VERSION,
				rendererVersion: END_CARD_RENDERER_VERSION,
				config,
				choices: [...choices]
					.sort((left, right) => left.optionKey.localeCompare(right.optionKey))
					.map((choice) => ({
						id: choice.id,
						optionKey: choice.optionKey,
						label: choice.label,
						consequence: choice.consequence,
					})),
				template: {
					version: template.version,
					background: template.background,
					panel: template.panel,
					accent: template.accent,
					text: template.text,
					font: template.font,
					splitPanelB: template.splitPanelB ?? null,
				},
			}),
		)
		.digest('hex');
}
