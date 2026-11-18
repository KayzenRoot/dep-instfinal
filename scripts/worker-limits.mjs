import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';

export async function freeDiskMb(path = tmpdir()) {
	const info = await statfs(path);
	return (Number(info.bavail) * Number(info.bsize)) / (1024 * 1024);
}

export async function assertDiskReserve({ path = tmpdir(), reserveMb = 2_048 } = {}) {
	const freeMb = await freeDiskMb(path);
	if (freeMb < reserveMb) {
		const error = new Error('WORKER_DISK_RESERVED');
		error.code = 'WORKER_DISK_RESERVED';
		error.freeMb = freeMb;
		error.reserveMb = reserveMb;
		throw error;
	}
	return freeMb;
}

export function clampThreads(value, fallback = 2) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(1, Math.min(8, Math.floor(parsed)));
}
