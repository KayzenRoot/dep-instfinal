export function freeDiskMb(path?: string): Promise<number>;
export function assertDiskReserve(options?: { path?: string; reserveMb?: number }): Promise<number>;
export function clampThreads(value: unknown, fallback?: number): number;
export function finiteNumber(value: unknown, fallback: number, min: number, max: number): number;
