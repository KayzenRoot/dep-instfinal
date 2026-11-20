import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_CONFIG } from '#lib/domain/style-bible.js';
import { styleConfigHash } from '#lib/domain/style-config-hash.js';
import { loadPresetsBulk } from './style-bible.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const owner = { id: ownerId } as never;
const config = DEFAULT_STYLE_CONFIG;
const configHash = styleConfigHash(config);

function presetId(index: number): string {
	return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
}

function makeRows() {
	const rows: Array<Record<string, unknown>> = [];
	for (let preset = 1; preset <= 6; preset += 1) {
		for (let revision = 1; revision <= 200; revision += 1) {
			rows.push({
				id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(preset * 1_000 + revision).padStart(12, '0')}`,
				preset_id: presetId(preset),
				revision_number: revision,
				config,
				config_hash: configHash,
				hash_version: 1,
				status: preset === 1 && revision === 100 ? 'APPROVED' : 'DRAFT',
				created_at: '2026-11-20T12:00:00Z',
			});
		}
	}
	return rows.sort((left, right) => Number(right.revision_number) - Number(left.revision_number));
}

function database(rows: Array<Record<string, unknown>>) {
	const ranges: Array<[number, number]> = [];
	const chain = {
		select: () => chain,
		eq: () => chain,
		in: () => chain,
		order: () => chain,
		range: (from: number, to: number) => {
			ranges.push([from, to]);
			return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
		},
	};
	return { db: { from: () => chain } as never, ranges };
}

describe('loadPresetsBulk', () => {
	it('paginates past the PostgREST 1000-row cap and keeps latest/approved', async () => {
		const rows = makeRows();
		const { db, ranges } = database(rows);
		const presets = await loadPresetsBulk(
			db,
			owner,
			Array.from({ length: 6 }, (_, index) => ({
				id: presetId(index + 1),
				owner_id: ownerId,
				scope_type: 'SERIES',
				scope_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
				name: `Preset ${index + 1}`,
				created_at: '2026-11-20T12:00:00Z',
				updated_at: '2026-11-20T12:00:00Z',
			})) as never,
		);
		expect(ranges.length).toBeGreaterThanOrEqual(2);
		expect(ranges[0]).toEqual([0, 999]);
		expect(ranges[1]).toEqual([1_000, 1_999]);
		expect(presets[0]?.revisions).toHaveLength(200);
		expect(presets[0]?.latestRevision).toBe(200);
		expect(presets[0]?.approved?.revision).toBe(100);
		expect(presets[5]?.revisions).toHaveLength(200);
	});
});
