import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { InMemoryVideoStorage } from './video-storage.js';
import { AudioLibraryError, isAudioExportable, storeAudioAsset } from './audio-library.js';

function hasFfmpeg(): boolean {
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

const enabled = hasFfmpeg();
let workspace: string | null = null;

beforeAll(async () => {
	if (enabled) workspace = await mkdtemp(join(tmpdir(), 'dif-audio-library-test-'));
});

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

function fakeAdmin(existing = false) {
	return {
		from() {
			return {
				select() {
					return {
						eq() {
							return {
								eq() {
									return {
										async maybeSingle() {
											return { data: existing ? { id: 'duplicate' } : null, error: null };
										},
									};
								},
							};
						},
					};
				},
				insert(row: Record<string, unknown>) {
					return {
						select() {
							return {
								async single() {
									return {
										data: { ...row, created_at: new Date().toISOString() },
										error: null,
									};
								},
							};
						},
					};
				},
			};
		},
	} as unknown as SupabaseClient;
}

const metadata = {
	kind: 'SFX',
	title: 'Impacto sintético',
	author: 'DIF Studio',
	source: 'Fixture local',
	licenseName: 'CC0 1.0',
	licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
	attribution: 'DIF Studio, CC0',
	commercialAllowed: true,
	socialAllowed: true,
	licenseStatus: 'VERIFIED',
	tags: ['impacto', 'susto'],
	intensity: 5,
};

async function fixture(name: string, args: string[]): Promise<Buffer> {
	const path = join(workspace!, name);
	execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, path], {
		timeout: 60_000,
		windowsHide: true,
	});
	return readFile(path);
}

describe.skipIf(!enabled)('audio library ingestion', () => {
	const owner = { id: '11111111-1111-4111-8111-111111111111' } as User;

	it('stores a licensed WAV with licence provenance and private bytes', async () => {
		const storage = new InMemoryVideoStorage();
		const bytes = await fixture('impact.wav', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=900:sample_rate=48000:duration=1',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
		]);
		const asset = await storeAudioAsset({
			adminDb: fakeAdmin(),
			owner,
			storage,
			bytes,
			fileName: 'impact.wav',
			metadata,
		});
		expect(asset.licenseStatus).toBe('VERIFIED');
		expect(isAudioExportable(asset)).toBe(true);
		expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(asset.durationMs).toBeGreaterThanOrEqual(900);
		const key = [...storage.objects.keys()][0]!;
		expect(key).toBe(`audio/${owner.id}/${asset.id}.wav`);
		expect(storage.getObjectForTest(key)?.length).toBe(bytes.length);
	});

	it('keeps unknown licences in the library but blocks export', async () => {
		const asset = await storeAudioAsset({
			adminDb: fakeAdmin(),
			owner,
			storage: new InMemoryVideoStorage(),
			bytes: await fixture('unknown.wav', [
				'-f',
				'lavfi',
				'-i',
				'sine=frequency=400:sample_rate=48000:duration=1',
				'-ac',
				'1',
				'-c:a',
				'pcm_s16le',
			]),
			fileName: 'unknown.wav',
			metadata: {
				...metadata,
				licenseStatus: 'UNKNOWN',
				commercialAllowed: false,
				socialAllowed: false,
			},
		});
		expect(asset.licenseStatus).toBe('UNKNOWN');
		expect(isAudioExportable(asset)).toBe(false);
	});

	it('rejects invalid metadata, duplicates and format mismatches', async () => {
		const storage = new InMemoryVideoStorage();
		const bytes = await fixture('music.wav', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=200:sample_rate=48000:duration=1',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
		]);
		await expect(
			storeAudioAsset({
				adminDb: fakeAdmin(),
				owner,
				storage,
				bytes,
				fileName: 'music.wav',
				metadata: { ...metadata, licenseStatus: 'VERIFIED', commercialAllowed: false },
			}),
		).rejects.toMatchObject({ code: 'AUDIO_METADATA_INVALID' });
		await expect(
			storeAudioAsset({
				adminDb: fakeAdmin(true),
				owner,
				storage,
				bytes,
				fileName: 'music.wav',
				metadata: { ...metadata, kind: 'MUSIC' },
			}),
		).rejects.toMatchObject({ code: 'AUDIO_DUPLICATE' });
		await expect(
			storeAudioAsset({
				adminDb: fakeAdmin(),
				owner,
				storage,
				bytes,
				fileName: 'music.mp3',
				metadata: { ...metadata, kind: 'MUSIC' },
			}),
		).rejects.toBeInstanceOf(AudioLibraryError);
	});
});
