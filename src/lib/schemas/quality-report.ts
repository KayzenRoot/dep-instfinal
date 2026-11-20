import { z } from 'zod';

export const QUALITY_CHECK_STATUSES = ['PASS', 'WARN', 'BLOCKED', 'NOT_TESTED'] as const;
export const qualityCheckStatusSchema = z.enum(QUALITY_CHECK_STATUSES);

export const qualityEvidenceSchema = z.object({
	startMs: z.number().int().min(0).optional(),
	endMs: z.number().int().min(0).optional(),
	value: z.number().finite().optional(),
	unit: z.string().max(24).optional(),
	detail: z.string().max(500).optional(),
});

export const qualityCheckSchema = z.object({
	id: z
		.string()
		.regex(/^[A-Z0-9_]{2,64}$/)
		.max(64),
	label: z.string().min(1).max(120),
	status: qualityCheckStatusSchema,
	severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']).optional(),
	message: z.string().min(1).max(500),
	tolerance: z.string().max(160).optional(),
	evidence: z.array(qualityEvidenceSchema).max(50),
});

export const qualityExceptionSchema = z.object({
	checkId: z.string().max(64),
	startMs: z.number().int().min(0),
	endMs: z.number().int().min(0),
	reason: z.string().min(1).max(300),
	source: z.enum(['DIRECTOR', 'OWNER']),
});

export const qualityArtifactSchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	byteSize: z.number().int().min(1),
	durationMs: z.number().int().min(1),
	width: z.number().int().min(1),
	height: z.number().int().min(1),
	fps: z.number().min(1).max(120),
	videoCodec: z.string().min(1).max(32),
	pixelFormat: z.string().min(1).max(32),
	audioCodec: z.string().max(32).nullable(),
	audioChannels: z.number().int().min(0).max(16),
	sampleRate: z.number().int().min(0).max(384_000),
});

export const qualityInspectionReportSchema = z.object({
	schemaVersion: z.literal(1),
	jobId: z.string().uuid(),
	episodeId: z.string().uuid(),
	planId: z.string().uuid(),
	planVersion: z.number().int().min(1),
	planSha256: z.string().regex(/^[0-9a-f]{64}$/),
	artifact: qualityArtifactSchema,
	summary: z.object({
		pass: z.number().int().min(0),
		warn: z.number().int().min(0),
		blocked: z.number().int().min(0),
		notTested: z.number().int().min(0),
	}),
	checks: z.array(qualityCheckSchema).min(1).max(40),
	exceptions: z.array(qualityExceptionSchema).max(50),
	inspectedAt: z.string().datetime(),
});

export type QualityCheckStatus = z.infer<typeof qualityCheckStatusSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type QualityException = z.infer<typeof qualityExceptionSchema>;
export type QualityInspectionReport = z.infer<typeof qualityInspectionReportSchema>;

export function summarizeChecks(checks: QualityCheck[]): QualityInspectionReport['summary'] {
	return {
		pass: checks.filter((check) => check.status === 'PASS').length,
		warn: checks.filter((check) => check.status === 'WARN').length,
		blocked: checks.filter((check) => check.status === 'BLOCKED').length,
		notTested: checks.filter((check) => check.status === 'NOT_TESTED').length,
	};
}

export function reportStatus(checks: QualityCheck[]): 'PASS' | 'WARN' | 'BLOCKED' | 'NOT_TESTED' {
	if (checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED';
	if (checks.some((check) => check.status === 'WARN')) return 'WARN';
	if (checks.every((check) => check.status === 'NOT_TESTED')) return 'NOT_TESTED';
	return 'PASS';
}

/** Checks that must never be NOT_TESTED before an artifact is downloadable. */
export const CRITICAL_QUALITY_CHECKS = [
	'ARTIFACT_HASH',
	'PLAN_HASH',
	'CONTAINER',
	'DURATION',
	'AUDIO_STREAM',
	'DECODE',
	'SAFE_AREA',
	'CAPTIONS',
	'CTA',
	'END_CARD',
] as const;

export type DownloadBlockReason =
	| 'RENDER_NOT_READY'
	| 'QUALITY_BLOCKED'
	| 'QUALITY_NOT_TESTED'
	| 'QUALITY_ACK_REQUIRED'
	| `QUALITY_CHECK_UNTESTED:${string}`;

export function downloadBlockReason(input: {
	status: QualityCheckStatus | string;
	checks: Array<{ id: string; status: string }>;
	acknowledgedAt: string | null;
}): DownloadBlockReason | null {
	if (input.status === 'BLOCKED') return 'QUALITY_BLOCKED';
	if (input.status === 'NOT_TESTED') return 'QUALITY_NOT_TESTED';
	if (input.status === 'WARN' && !input.acknowledgedAt) return 'QUALITY_ACK_REQUIRED';
	const untested = input.checks.find(
		(check) =>
			(CRITICAL_QUALITY_CHECKS as readonly string[]).includes(check.id) &&
			check.status === 'NOT_TESTED',
	);
	return untested ? `QUALITY_CHECK_UNTESTED:${untested.id}` : null;
}
