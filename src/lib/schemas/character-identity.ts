import { z } from 'zod';

const uuid = z.string().uuid();
const identityText = (max: number) => z.string().trim().max(max).default('');
const identityList = (maxItems: number, maxLength: number) =>
	z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).default([]);

export const identityLookSchema = z
	.object({
		id: z
			.string()
			.trim()
			.regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
		label: z.string().trim().min(1).max(80),
		appliesFromEpisode: z.number().int().min(1).max(99),
		appliesToEpisode: z.number().int().min(1).max(99).nullable().default(null),
		wardrobe: identityText(300),
		hair: identityText(200),
		notes: identityText(500),
	})
	.refine(
		(look) => look.appliesToEpisode === null || look.appliesToEpisode >= look.appliesFromEpisode,
		{
			message: 'O fim da validade do look deve ser posterior ao início.',
			path: ['appliesToEpisode'],
		},
	);

export const identityReferenceSchema = z.object({
	assetId: uuid,
	label: z.string().trim().min(1).max(80).default('Referência'),
	role: z.enum(['PRIMARY', 'SUPPORTING']).default('SUPPORTING'),
});

export const characterIdentityProfileSchema = z
	.object({
		schemaVersion: z.literal(1),
		characterId: uuid,
		seriesId: uuid,
		status: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
		aliases: identityList(10, 80),
		visualTraits: z.object({
			hair: identityText(200),
			wardrobe: identityText(300),
			silhouette: identityText(200),
			marks: identityText(200),
			accessories: identityText(200),
		}),
		palette: identityText(200),
		lighting: identityText(200),
		immutableAccessories: identityList(10, 80),
		mutableAccessories: identityList(10, 80),
		negativePrompts: identityList(10, 120),
		references: z.array(identityReferenceSchema).max(6).default([]),
		primaryReferenceAssetId: uuid.nullable().default(null),
		looks: z.array(identityLookSchema).max(20).default([]),
		anchorOverrideEn: identityText(1_200),
		notes: identityText(1_000),
	})
	.superRefine((profile, context) => {
		const lookIds = new Set<string>();
		for (const [index, look] of profile.looks.entries()) {
			if (lookIds.has(look.id))
				context.addIssue({
					code: 'custom',
					message: 'Cada look precisa de um id único.',
					path: ['looks', index, 'id'],
				});
			lookIds.add(look.id);
		}
		const referenceIds = new Set(profile.references.map((reference) => reference.assetId));
		if (profile.references.length !== referenceIds.size)
			context.addIssue({
				code: 'custom',
				message: 'A mesma referência não pode aparecer duas vezes.',
				path: ['references'],
			});
		if (profile.primaryReferenceAssetId && !referenceIds.has(profile.primaryReferenceAssetId))
			context.addIssue({
				code: 'custom',
				message: 'A referência principal precisa estar na lista de referências.',
				path: ['primaryReferenceAssetId'],
			});
		const primary = profile.references.filter((reference) => reference.role === 'PRIMARY');
		if (primary.length > 1)
			context.addIssue({
				code: 'custom',
				message: 'Escolha no máximo uma referência principal.',
				path: ['references'],
			});
		const looks = [...profile.looks].sort(
			(left, right) => left.appliesFromEpisode - right.appliesFromEpisode,
		);
		for (let index = 1; index < looks.length; index += 1) {
			const previous = looks[index - 1];
			const current = looks[index];
			if (
				previous &&
				current &&
				(previous.appliesToEpisode === null ||
					current.appliesFromEpisode <= previous.appliesToEpisode)
			)
				context.addIssue({
					code: 'custom',
					message: 'Os intervalos de episódios dos looks não podem se sobrepor.',
					path: ['looks'],
				});
		}
	});

export const identityProfileStatusSchema = z.enum(['DRAFT', 'APPROVED']);

export type IdentityLook = z.infer<typeof identityLookSchema>;
export type IdentityReference = z.infer<typeof identityReferenceSchema>;
export type CharacterIdentityProfile = z.infer<typeof characterIdentityProfileSchema>;
