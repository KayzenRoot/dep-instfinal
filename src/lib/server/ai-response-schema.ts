// Supported JSON Schema subset for Gemini GenerateContent.responseJsonSchema.
// JSON MIME mode without this schema is advisory and can produce malformed JSON.
const text = { type: 'string' } as const;
const integer = { type: 'integer' } as const;

function textProperties(keys: readonly string[]) {
	return Object.fromEntries(keys.map((key) => [key, text]));
}

const social = {
	type: 'object',
	properties: textProperties(['title', 'cta', 'description']),
	required: ['title', 'cta', 'description'],
	additionalProperties: false,
} as const;

const choice = {
	type: 'object',
	properties: textProperties(['label', 'consequence']),
	required: ['label', 'consequence'],
	additionalProperties: false,
} as const;

const sceneTextFields = [
	'narrationPtBr',
	'visualDescription',
	'cameraNotes',
	'lightingNotes',
	'startFramePromptEn',
	'endFramePromptEn',
	'motionPromptEn',
	'audioNotes',
	'location',
	'characterNotes',
	'vhsEffects',
	'transition',
] as const;

const narrativeTextFields = [
	'title',
	'logline',
	'hook',
	'narrative',
	'narrationPtBr',
	'reveal',
	'cliffhanger',
	'screenSuggestion',
	'soundSuggestion',
	'coverText',
] as const;

export const geminiEpisodeJsonSchema = {
	type: 'object',
	properties: {
		narrative: {
			type: 'object',
			properties: {
				...textProperties(narrativeTextFields),
				durationSeconds: { ...integer, minimum: 90, maximum: 150 },
				speechSpeedWpm: { ...integer, minimum: 80, maximum: 220 },
				tiktok: social,
				instagram: social,
				choices: { type: 'array', items: choice, maxItems: 2 },
			},
			required: [
				...narrativeTextFields,
				'durationSeconds',
				'speechSpeedWpm',
				'tiktok',
				'instagram',
				'choices',
			],
			additionalProperties: false,
		},
		scenes: {
			type: 'array',
			minItems: 1,
			maxItems: 38,
			items: {
				type: 'object',
				properties: {
					sceneIndex: { ...integer, minimum: 1, maximum: 38 },
					...textProperties(sceneTextFields),
				},
				required: ['sceneIndex', ...sceneTextFields],
				additionalProperties: false,
			},
		},
	},
	required: ['narrative', 'scenes'],
	additionalProperties: false,
} as const;
