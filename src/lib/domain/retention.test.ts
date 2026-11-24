import { describe, expect, it } from 'vitest';
import {
	compareVariantObservations,
	computeRetentionMetrics,
	LOW_SAMPLE_VIEWS,
	parseCsvRows,
	parseRetentionCsv,
	RetentionError,
	retentionCsv,
	sanitizeCsvCell,
	type VariantObservation,
} from './retention.js';

function metrics(overrides: Partial<Parameters<typeof computeRetentionMetrics>[0]> = {}) {
	return {
		views: 10_000,
		likes: 400,
		comments: 50,
		shares: 30,
		saves: 20,
		followersGained: 10,
		avgWatchMs: null,
		completionPct: null,
		...overrides,
	};
}

function observation(overrides: Partial<VariantObservation> = {}): VariantObservation {
	return {
		platform: 'tiktok',
		label: 'Post',
		variantLabel: 'A',
		periodStart: '2026-11-01T00:00:00Z',
		periodEnd: '2026-11-08T00:00:00Z',
		views: 10_000,
		metrics: computeRetentionMetrics(metrics(), 120_000),
		...overrides,
	};
}

describe('retention formulas', () => {
	it('computes explicit ratios with visible denominators', () => {
		const result = computeRetentionMetrics(metrics({ avgWatchMs: 60_000 }), 120_000);
		expect(result.totalInteractions).toBe(500);
		expect(result.engagementRate).toBe(0.05);
		expect(result.interactionsPer1000).toBe(50);
		expect(result.completionPct).toBe(50);
		expect(result.watchTimeRelative).toBe(0.5);
		expect(result.metricVersion).toBe(1);
		expect(result.missing).toEqual([]);
	});

	it('never turns missing metrics into zero and flags partial interactions', () => {
		const result = computeRetentionMetrics(
			metrics({ likes: null, comments: null, shares: null, saves: null }),
			120_000,
		);
		expect(result.totalInteractions).toBeNull();
		expect(result.engagementRate).toBeNull();
		expect(result.interactionsPer1000).toBeNull();
		expect(result.missing).toContain('interactions');
		expect(result.interactionCoverage).toBe('NONE');

		const partial = computeRetentionMetrics(
			metrics({ likes: null, comments: 50, shares: 30, saves: 20 }),
			120_000,
		);
		expect(partial.interactionCoverage).toBe('PARTIAL');
		expect(partial.warnings).toContain('PARTIAL_INTERACTIONS');
		const full = observation();
		const partialObservation = observation({ metrics: partial });
		expect(compareVariantObservations(full, partialObservation, 'engagement_rate')).toMatchObject({
			status: 'INSUFFICIENT',
			warnings: expect.arrayContaining(['INTERACTION_COVERAGE_MISMATCH']),
		});

		const noViews = computeRetentionMetrics(metrics({ views: null }), 120_000);
		expect(noViews.engagementRate).toBeNull();
		expect(noViews.missing).toContain('views');
	});

	it('handles zero views, low samples and completion discrepancy', () => {
		expect(computeRetentionMetrics(metrics({ views: 0 }), 120_000).warnings).toContain(
			'ZERO_VIEWS',
		);
		const low = computeRetentionMetrics(metrics({ views: LOW_SAMPLE_VIEWS - 1 }), 120_000);
		expect(low.warnings).toContain('LOW_SAMPLE');
		const discrepancy = computeRetentionMetrics(
			metrics({ avgWatchMs: 30_000, completionPct: 80 }),
			120_000,
		);
		expect(discrepancy.warnings).toContain('COMPLETION_DISCREPANCY');
	});

	it('rejects watch time above the episode duration, including 105%', () => {
		expect(() => computeRetentionMetrics(metrics({ avgWatchMs: 126_000 }), 120_000)).toThrow(
			RetentionError,
		);
		expect(() => computeRetentionMetrics(metrics({ avgWatchMs: 130_000 }), 120_000)).toThrow(
			RetentionError,
		);
	});
});

describe('variant comparison', () => {
	it('compares only same-platform, comparable windows', () => {
		const base = observation();
		const platform = compareVariantObservations(
			base,
			observation({ platform: 'reels' }),
			'engagement_rate',
		);
		expect(platform.status).toBe('NOT_COMPARABLE');

		const period = compareVariantObservations(
			base,
			observation({ periodEnd: '2026-12-01T00:00:00Z' }),
			'engagement_rate',
		);
		expect(period.status).toBe('NOT_COMPARABLE');
		expect(period.warnings).toContain('PERIOD_LENGTH_MISMATCH');
	});

	it('returns insufficient for low samples or missing metrics', () => {
		const base = observation();
		expect(
			compareVariantObservations(base, observation({ views: 500 }), 'engagement_rate').status,
		).toBe('INSUFFICIENT');
		const missing = observation({
			metrics: computeRetentionMetrics(
				metrics({ likes: null, comments: null, shares: null, saves: null }),
				120_000,
			),
		});
		expect(compareVariantObservations(base, missing, 'engagement_rate').status).toBe(
			'INSUFFICIENT',
		);
	});

	it('reports an observational association without causal or viral language', () => {
		const base = observation();
		const better = observation({
			views: 12_000,
			metrics: computeRetentionMetrics(metrics({ views: 12_000, likes: 900 }), 120_000),
		});
		const comparison = compareVariantObservations(base, better, 'engagement_rate');
		expect(comparison.status).toBe('OBSERVATIONAL');
		expect(comparison.summary).toContain('observado');
		expect(comparison.summary).toContain('não causalidade');
		for (const word of ['viral', 'garantia', 'causou'])
			expect(comparison.summary.toLowerCase()).not.toContain(word);
	});
});

describe('CSV import and export', () => {
	const header =
		'platform,url,published_at,label,period_start,period_end,captured_at,views,likes,comments,shares,saves,followers_gained,avg_watch_ms,completion_pct,note';

	it('parses quoted fields, empty values as null and CRLF', () => {
		const csv = `${header}\r\nTikTok,https://www.tiktok.com/@x/video/1,2026-11-01T00:00:00Z,"A, fita",2026-11-01T00:00:00Z,2026-11-08T00:00:00Z,2026-11-09T00:00:00Z,10000,,12,,,0,60000,50,"linha 1\nlinha 2"\r\n`;
		const parsed = parseRetentionCsv(csv);
		expect(parsed.errors).toEqual([]);
		expect(parsed.rows).toHaveLength(1);
		expect(parsed.rows[0]).toMatchObject({
			platform: 'tiktok',
			label: 'A, fita',
			likes: null,
			comments: 12,
			shares: null,
			views: 10_000,
			completion_pct: 50,
		});
	});

	it('preserves escaped quotes, multiline fields and blank CRLF records', () => {
		const rows = parseCsvRows('h1,h2,h3\r\n"a""b\nc",,42\r\n\r\n');
		expect(rows).toEqual([
			['h1', 'h2', 'h3'],
			['a"b\nc', '', '42'],
		]);
	});

	it('consumes consecutive escaped quote pairs without skipping CSV cells', () => {
		const rows = parseCsvRows('"a""""b","x,y"\n"q""r",ok\n');
		expect(rows).toEqual([
			['a""b', 'x,y'],
			['q"r', 'ok'],
		]);
	});

	it('advances through a long run of escaped quotes exactly once', () => {
		const csv = `"${'""'.repeat(1_024)}",end\n`;
		expect(parseCsvRows(csv)).toEqual([['"'.repeat(1_024), 'end']]);
	});

	it('rejects malformed rows without dropping valid ones', () => {
		const csv = `${header}\nTikTok,https://www.tiktok.com/@x/video/1,2026-11-01T00:00:00Z,A,2026-11-08T00:00:00Z,2026-11-01T00:00:00Z,2026-11-09T00:00:00Z,100,1,1,1,1,0,30000,50,ok\nTikTok,not-a-url,2026-11-01T00:00:00Z,A,2026-11-01T00:00:00Z,2026-11-08T00:00:00Z,2026-11-09T00:00:00Z,100,1,1,1,1,0,30000,50,ok`;
		const parsed = parseRetentionCsv(csv);
		expect(parsed.rows).toHaveLength(0);
		expect(parsed.errors).toHaveLength(2);
		expect(() => parseRetentionCsv('a,b\n1,2')).toThrow(RetentionError);
	});

	it('guards formula injection including commas and newlines', () => {
		expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe(`"'=SUM(A1:A2)"`);
		expect(sanitizeCsvCell('@user')).toBe(`"'@user"`);
		expect(sanitizeCsvCell('a,b')).toBe('"a,b"');
		expect(sanitizeCsvCell('=1,2')).toBe(`"'=1,2"`);
		const csv = retentionCsv([{ label: '=x\n=HYPERLINK("https://evil.example")', views: 10 }]);
		const parsed = parseCsvRows(csv);
		expect(parsed).toHaveLength(2);
		expect(parsed[1]).toHaveLength(2);
		expect(parsed[1]?.[0]).toContain(`'=HYPERLINK`);
	});

	it('rejects ambiguous thousands separators in CSV numbers', () => {
		const csv = `${header}\nTikTok,https://www.tiktok.com/@x/video/1,2026-11-01T00:00:00Z,A,2026-11-01T00:00:00Z,2026-11-08T00:00:00Z,2026-11-09T00:00:00Z,1.000,1,1,1,1,0,30000,50,ok`;
		const parsed = parseRetentionCsv(csv);
		expect(parsed.rows).toHaveLength(0);
		expect(parsed.errors[0]?.message).toContain('Número inteiro inválido');
	});
});
