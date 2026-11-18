import { describe, expect, it } from 'vitest';
import {
	downloadBlockReason,
	qualityInspectionReportSchema,
	reportStatus,
	summarizeChecks,
	type QualityCheck,
} from './quality-report.js';

function check(id: string, status: QualityCheck['status']): QualityCheck {
	return { id, label: id, status, message: `${id} ${status}`, evidence: [] };
}

describe('quality report contract', () => {
	it('summarizes checks and prioritizes blocked over warn', () => {
		const checks = [
			check('DECODE', 'PASS'),
			check('BLACK_FRAMES', 'WARN'),
			check('CAPTIONS', 'NOT_TESTED'),
		];
		expect(summarizeChecks(checks)).toEqual({ pass: 1, warn: 1, blocked: 0, notTested: 1 });
		expect(reportStatus(checks)).toBe('WARN');
		expect(reportStatus([...checks, check('CONTAINER', 'BLOCKED')])).toBe('BLOCKED');
		expect(reportStatus([check('A', 'NOT_TESTED')])).toBe('NOT_TESTED');
		expect(reportStatus([check('A', 'PASS')])).toBe('PASS');
	});

	it('rejects malformed reports', () => {
		const base = {
			schemaVersion: 1,
			jobId: '55555555-5555-4555-8555-555555555555',
			episodeId: '11111111-1111-4111-8111-111111111111',
			planId: '66666666-6666-4666-8666-666666666666',
			planVersion: 1,
			planSha256: 'a'.repeat(64),
			artifact: {
				sha256: 'b'.repeat(64),
				byteSize: 1024,
				durationMs: 3_000,
				width: 1080,
				height: 1920,
				fps: 30,
				videoCodec: 'h264',
				pixelFormat: 'yuv420p',
				audioCodec: 'aac',
				audioChannels: 2,
				sampleRate: 48_000,
			},
			summary: { pass: 1, warn: 0, blocked: 0, notTested: 0 },
			checks: [check('DECODE', 'PASS')],
			exceptions: [],
			inspectedAt: '2026-11-18T12:00:00.000Z',
		};
		expect(qualityInspectionReportSchema.safeParse(base).success).toBe(true);
		expect(qualityInspectionReportSchema.safeParse({ ...base, planSha256: 'short' }).success).toBe(
			false,
		);
		expect(qualityInspectionReportSchema.safeParse({ ...base, checks: [] }).success).toBe(false);
	});

	it('blocks download on blocked, untested-critical and unacknowledged warn reports', () => {
		expect(
			downloadBlockReason({
				status: 'PASS',
				checks: [check('DECODE', 'PASS'), check('SAFE_AREA', 'NOT_TESTED')],
				acknowledgedAt: null,
			}),
		).toBe('QUALITY_CHECK_UNTESTED:SAFE_AREA');
		expect(
			downloadBlockReason({
				status: 'WARN',
				checks: [check('BLACK_FRAMES', 'WARN')],
				acknowledgedAt: null,
			}),
		).toBe('QUALITY_ACK_REQUIRED');
		expect(
			downloadBlockReason({
				status: 'WARN',
				checks: [check('BLACK_FRAMES', 'WARN')],
				acknowledgedAt: '2026-11-18T12:00:00.000Z',
			}),
		).toBeNull();
		expect(
			downloadBlockReason({
				status: 'BLOCKED',
				checks: [check('DECODE', 'BLOCKED')],
				acknowledgedAt: null,
			}),
		).toBe('QUALITY_BLOCKED');
	});
});
