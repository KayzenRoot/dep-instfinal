import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE_CONFIG } from '#lib/domain/style-bible.js';
import { styleConfigSchema } from '#lib/schemas/style-bible.js';
import { saveStylePreset, StyleServiceError } from './style-bible.js';

const owner = { id: '11111111-1111-4111-8111-111111111111' } as never;
const scopeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sfxId = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

function databaseWith(rows: Array<Record<string, unknown>>) {
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: () => Promise.resolve({ data: rows, error: null }),
	};
	return { from: () => chain };
}

function values() {
	return {
		scopeType: 'SERIES',
		scopeId,
		name: 'Preset com SFX',
		expectedRevision: 0,
		status: 'DRAFT',
		config: styleConfigSchema.parse({
			...DEFAULT_STYLE_CONFIG,
			sfxCategory: 'pulse',
			sfxAssetIds: [sfxId],
		}),
	};
}

describe('style SFX license gate', () => {
	it('rejects a missing asset with a readable conflict before writing', async () => {
		const adminDb = { rpc: vi.fn() };
		await expect(
			saveStylePreset({
				db: databaseWith([]) as never,
				adminDb: adminDb as never,
				owner,
				values: values(),
			}),
		).rejects.toMatchObject({ status: 409, code: 'STYLE_ASSET_MISSING' });
		expect(adminDb.rpc).not.toHaveBeenCalled();
	});

	it('rejects an unlicensed asset and accepts a fully licensed one', async () => {
		const unlicensed = {
			id: sfxId,
			license_status: 'VERIFIED',
			commercial_allowed: true,
			social_allowed: false,
		};
		const adminDb = { rpc: vi.fn() };
		const error = await saveStylePreset({
			db: databaseWith([unlicensed]) as never,
			adminDb: adminDb as never,
			owner,
			values: values(),
		}).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(StyleServiceError);
		expect(error).toMatchObject({ status: 409, code: 'STYLE_LICENSE_BLOCKED' });
		expect(adminDb.rpc).not.toHaveBeenCalled();

		adminDb.rpc.mockResolvedValue({ data: 1, error: null });
		await expect(
			saveStylePreset({
				db: databaseWith([{ ...unlicensed, social_allowed: true }]) as never,
				adminDb: adminDb as never,
				owner,
				values: values(),
			}),
		).resolves.toEqual({ revision: 1 });
		expect(adminDb.rpc).toHaveBeenCalledWith(
			'save_style_preset_revision',
			expect.objectContaining({ p_config_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
		);
	});
});
