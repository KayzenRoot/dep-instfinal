import { beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => {
	class CharacterIdentityError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return {
		CharacterIdentityError,
		loadOwnerSeriesOptions: vi.fn(),
		loadSeriesCharacters: vi.fn(),
		loadCharacterIdentityDetail: vi.fn(),
		loadIdentityPromptBundle: vi.fn(),
		saveCharacterIdentityProfile: vi.fn(),
		restoreCharacterIdentityProfileVersion: vi.fn(),
	};
});
const authorized = vi.hoisted(() => ({
	ownerDatabase: vi.fn(),
	readFormText: (form: FormData, key: string) => {
		const value = form.get(key);
		return typeof value === 'string' ? value : '';
	},
}));

vi.mock('#lib/server/character-identity.js', () => identity);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));

import { actions } from './+page.server.js';

const characterId = '11111111-1111-4111-8111-111111111111';
const seriesId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

function event(fields: Record<string, string>, extra: Array<[string, string]> = []) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	for (const [key, value] of extra) form.append(key, value);
	return {
		request: new Request('http://localhost/app/identity?/save', { method: 'POST', body: form }),
		url: new URL('http://localhost/app/identity'),
		params: {},
	} as never;
}

function fields(overrides: Record<string, string> = {}) {
	return {
		characterId,
		expectedVersion: '0',
		aliases: 'Lara\nA Arquivista',
		hair: 'cabelo preto',
		wardrobe: 'sobretudo',
		silhouette: 'alta',
		marks: 'cicatriz',
		accessories: 'colar',
		palette: 'verde',
		lighting: 'baixa',
		immutableAccessories: 'colar',
		mutableAccessories: 'luvas',
		negativePrompts: 'logos',
		looks: 'Arquivo | 1 | 3 | sobretudo | cabelo preto | notas',
		anchorOverrideEn: '',
		notes: '',
		primaryReferenceAssetId: '',
		...overrides,
	};
}

describe('identity page actions', () => {
	beforeEach(() => {
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		identity.loadCharacterIdentityDetail.mockResolvedValue({
			characterId,
			name: 'Lara',
			seriesId,
			version: null,
			profile: null,
			detail: true,
		});
		identity.saveCharacterIdentityProfile.mockResolvedValue(1);
		identity.restoreCharacterIdentityProfileVersion.mockResolvedValue(4);
	});

	it('rejects missing character or version', async () => {
		expect(await actions.save(event(fields({ expectedVersion: '' })))).toMatchObject({
			status: 400,
		});
		expect(await actions.save(event(fields({ characterId: '' })))).toMatchObject({ status: 400 });
		expect(identity.saveCharacterIdentityProfile).not.toHaveBeenCalled();
	});

	it('parses profile fields, looks and references then redirects', async () => {
		await expect(actions.save(event(fields(), [['referenceIds', assetId]]))).rejects.toMatchObject({
			status: 303,
			location: `/app/identity?seriesId=${seriesId}&characterId=${characterId}&mode=saved&saved=1`,
		});
		const call = identity.saveCharacterIdentityProfile.mock.calls[0]?.[0];
		expect(call.profile).toMatchObject({
			status: 'DRAFT',
			aliases: ['Lara', 'A Arquivista'],
			visualTraits: { hair: 'cabelo preto', wardrobe: 'sobretudo' },
			looks: [
				{
					label: 'Arquivo',
					appliesFromEpisode: 1,
					appliesToEpisode: 3,
					wardrobe: 'sobretudo',
				},
			],
			references: [{ assetId, role: 'SUPPORTING' }],
		});
	});

	it('marks the primary reference and approves through the same parser', async () => {
		await expect(
			actions.approve(
				event(fields({ primaryReferenceAssetId: assetId }), [['referenceIds', assetId]]),
			),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/identity?seriesId=${seriesId}&characterId=${characterId}&mode=approved&saved=1`,
		});
		const call = identity.saveCharacterIdentityProfile.mock.calls[0]?.[0];
		expect(call.profile).toMatchObject({
			status: 'APPROVED',
			primaryReferenceAssetId: assetId,
			references: [{ assetId, role: 'PRIMARY' }],
		});
	});

	it('maps identity conflicts and restores versions', async () => {
		identity.saveCharacterIdentityProfile.mockRejectedValue(
			new identity.CharacterIdentityError(409, 'IDENTITY_VERSION_CONFLICT', 'Recarregue.'),
		);
		await expect(actions.save(event(fields()))).resolves.toMatchObject({
			status: 409,
			data: { message: 'Recarregue.' },
		});
		await expect(
			actions.restore(event({ characterId, version: '2', expectedVersion: '3' })),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/identity?seriesId=${seriesId}&characterId=${characterId}&mode=restored&saved=4`,
		});
	});
});
