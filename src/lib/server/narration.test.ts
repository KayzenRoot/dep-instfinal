import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { InMemoryVideoStorage } from './video-storage.js';
import { NarrationError, storeNarrationTake } from './narration.js';

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
	if (enabled) workspace = await mkdtemp(join(tmpdir(), 'dif-narration-test-'));
});

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

function fakeAdmin(ownerId: string, episodeId: string) {
	return {
		from() {
			return {
				insert(row: Record<string, unknown>) {
					return {
						select() {
							return {
								async single() {
									return {
										data: { ...row, owner_id: ownerId, episode_id: episodeId },
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

const input = {
	owner: { id: '11111111-1111-4111-8111-111111111111' } as User,
	episodeId: 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
	planVersion: 1,
	source: 'UPLOAD' as const,
};

async function fixture(name: string, args: string[]): Promise<Buffer> {
	const path = join(workspace!, name);
	execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, path], {
		timeout: 60_000,
		windowsHide: true,
	});
	return readFile(path);
}

describe.skipIf(!enabled)('narration take upload validation', () => {
	it('stores a valid WAV with loudness and true peak', async () => {
		const storage = new InMemoryVideoStorage();
		const bytes = await fixture('voice.wav', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=300:sample_rate=48000:duration=3',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
		]);
		const take = await storeNarrationTake({
			...input,
			adminDb: fakeAdmin(input.owner.id, input.episodeId),
			storage,
			bytes,
			fileName: 'voice.wav',
		});
		expect(take.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(take.duration_ms).toBeGreaterThanOrEqual(2_900);
		expect(take.sample_rate).toBe(48_000);
		expect(take.channels).toBe(1);
		expect(take.peak_db).not.toBeNull();
		const objectKey = [...storage.objects.keys()][0]!;
		expect(objectKey).toMatch(
			new RegExp(`^narration/${input.owner.id}/${input.episodeId}/[0-9a-f-]+\\.wav$`),
		);
		expect(storage.getObjectForTest(objectKey)?.length).toBe(bytes.length);
	});

	it('rejects damaged bytes, silent audio and clipping', async () => {
		const storage = new InMemoryVideoStorage();
		const adminDb = fakeAdmin(input.owner.id, input.episodeId);
		await expect(
			storeNarrationTake({
				...input,
				adminDb,
				storage,
				bytes: Buffer.from('not-a-wave-file'),
				fileName: 'broken.wav',
			}),
		).rejects.toMatchObject({ code: 'NARRATION_AUDIO_INVALID' });

		const silent = await fixture('silent.wav', [
			'-f',
			'lavfi',
			'-i',
			'anullsrc=channel_layout=mono:sample_rate=48000',
			'-t',
			'3',
			'-c:a',
			'pcm_s16le',
		]);
		await expect(
			storeNarrationTake({ ...input, adminDb, storage, bytes: silent, fileName: 'silent.wav' }),
		).rejects.toMatchObject({ code: 'NARRATION_SILENT' });

		const clipped = await fixture('clipped.wav', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=300:sample_rate=48000:duration=3',
			'-af',
			'volume=30dB',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
		]);
		await expect(
			storeNarrationTake({ ...input, adminDb, storage, bytes: clipped, fileName: 'clipped.wav' }),
		).rejects.toMatchObject({ code: 'NARRATION_CLIPPING' });
	});

	it('rejects extension/content mismatch and oversized files', async () => {
		const storage = new InMemoryVideoStorage();
		const adminDb = fakeAdmin(input.owner.id, input.episodeId);
		const mp3 = await fixture('voice.mp3', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=300:sample_rate=44100:duration=3',
			'-ac',
			'1',
			'-c:a',
			'libmp3lame',
		]);
		await expect(
			storeNarrationTake({ ...input, adminDb, storage, bytes: mp3, fileName: 'voice.wav' }),
		).rejects.toMatchObject({ code: 'NARRATION_FORMAT_MISMATCH' });
		await expect(
			storeNarrationTake({
				...input,
				adminDb,
				storage,
				bytes: Buffer.alloc(20 * 1024 * 1024 + 1),
				fileName: 'large.wav',
			}),
		).rejects.toMatchObject({ code: 'NARRATION_TOO_LARGE' });
	});

	it('rejects durations below one second', async () => {
		const storage = new InMemoryVideoStorage();
		const adminDb = fakeAdmin(input.owner.id, input.episodeId);
		const short = await fixture('short.wav', [
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=300:sample_rate=48000:duration=0.5',
			'-c:a',
			'pcm_s16le',
		]);
		await expect(
			storeNarrationTake({ ...input, adminDb, storage, bytes: short, fileName: 'short.wav' }),
		).rejects.toBeInstanceOf(NarrationError);
	});
});
