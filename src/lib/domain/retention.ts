import {
	retentionImportRowSchema,
	type AnalyticsMetrics,
	type RetentionImportRow,
} from '#lib/schemas/retention.js';

export const RETENTION_METRIC_VERSION = 1;
export const LOW_SAMPLE_VIEWS = 1_000;

export class RetentionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'RetentionError';
	}
}

export interface MetricDefinition {
	id: 'engagement_rate' | 'completion_pct' | 'watch_time_relative' | 'interactions_per_1000';
	label: string;
	numerator: string;
	denominator: string;
	unit: 'ratio' | 'percent' | 'per_1000_views';
}

export const RETENTION_METRIC_DEFINITIONS: MetricDefinition[] = [
	{
		id: 'engagement_rate',
		label: 'Taxa de engajamento',
		numerator: 'likes + comentários + shares + saves disponíveis',
		denominator: 'views',
		unit: 'ratio',
	},
	{
		id: 'completion_pct',
		label: 'Taxa de conclusão',
		numerator: 'conclusão informada pela plataforma ou avg_watch_ms',
		denominator: 'duração do episódio',
		unit: 'percent',
	},
	{
		id: 'watch_time_relative',
		label: 'Tempo assistido relativo',
		numerator: 'avg_watch_ms',
		denominator: 'duração do episódio em ms',
		unit: 'ratio',
	},
	{
		id: 'interactions_per_1000',
		label: 'Interações por 1000 views',
		numerator: 'interações disponíveis',
		denominator: 'views / 1000',
		unit: 'per_1000_views',
	},
];

export interface ComputedRetentionMetrics {
	metricVersion: number;
	totalInteractions: number | null;
	engagementRate: number | null;
	completionPct: number | null;
	watchTimeRelative: number | null;
	interactionsPer1000: number | null;
	missing: string[];
	warnings: string[];
}

function sumAvailable(values: Array<number | null>): number | null {
	const available = values.filter((value): value is number => value !== null);
	return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function round(value: number, digits = 4): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

export function computeRetentionMetrics(
	metrics: AnalyticsMetrics,
	durationMs: number,
): ComputedRetentionMetrics {
	if (!Number.isFinite(durationMs) || durationMs <= 0)
		throw new RetentionError('RETENTION_DURATION_INVALID', 'Duração do episódio inválida.');
	if (metrics.avgWatchMs !== null && metrics.avgWatchMs > durationMs * 1.05)
		throw new RetentionError(
			'RETENTION_WATCH_EXCEEDS_DURATION',
			'Tempo médio assistido excede a duração do episódio.',
		);
	const missing: string[] = [];
	const warnings: string[] = [];
	const totalInteractions = sumAvailable([
		metrics.likes,
		metrics.comments,
		metrics.shares,
		metrics.saves,
	]);
	if (totalInteractions === null) missing.push('interactions');
	if (metrics.views === null) missing.push('views');
	if (metrics.avgWatchMs === null) missing.push('avg_watch_ms');
	if (metrics.completionPct === null && metrics.avgWatchMs === null) missing.push('completion');

	let engagementRate: number | null = null;
	let interactionsPer1000: number | null = null;
	if (metrics.views === null || metrics.views === 0) {
		if (metrics.views === 0) warnings.push('ZERO_VIEWS');
	} else if (totalInteractions !== null) {
		engagementRate = round(totalInteractions / metrics.views);
		interactionsPer1000 = round((totalInteractions / metrics.views) * 1_000, 2);
	}

	let watchTimeRelative: number | null = null;
	if (metrics.avgWatchMs !== null) watchTimeRelative = round(metrics.avgWatchMs / durationMs);

	let completionPct = metrics.completionPct;
	if (completionPct === null && metrics.avgWatchMs !== null)
		completionPct = round((metrics.avgWatchMs / durationMs) * 100, 2);
	else if (completionPct !== null) completionPct = round(completionPct, 2);
	if (
		metrics.completionPct !== null &&
		metrics.avgWatchMs !== null &&
		Math.abs(metrics.completionPct - (metrics.avgWatchMs / durationMs) * 100) > 5
	)
		warnings.push('COMPLETION_DISCREPANCY');

	if (metrics.views !== null && metrics.views < LOW_SAMPLE_VIEWS) warnings.push('LOW_SAMPLE');
	if (metrics.views !== null && metrics.views < (totalInteractions ?? 0))
		warnings.push('INTERACTIONS_EXCEED_VIEWS');
	return {
		metricVersion: RETENTION_METRIC_VERSION,
		totalInteractions,
		engagementRate,
		completionPct,
		watchTimeRelative,
		interactionsPer1000,
		missing,
		warnings,
	};
}

export interface VariantObservation {
	platform: string;
	label: string;
	variantLabel: string;
	periodStart: string;
	periodEnd: string;
	views: number | null;
	metrics: ComputedRetentionMetrics;
}

export interface VariantComparison {
	status: 'OBSERVATIONAL' | 'INSUFFICIENT' | 'NOT_COMPARABLE';
	metric: MetricDefinition['id'];
	valueA: number | null;
	valueB: number | null;
	summary: string;
	warnings: string[];
}

function metricValue(observation: VariantObservation, metric: MetricDefinition['id']) {
	if (metric === 'engagement_rate') return observation.metrics.engagementRate;
	if (metric === 'completion_pct') return observation.metrics.completionPct;
	if (metric === 'watch_time_relative') return observation.metrics.watchTimeRelative;
	return observation.metrics.interactionsPer1000;
}

export function compareVariantObservations(
	left: VariantObservation,
	right: VariantObservation,
	metric: MetricDefinition['id'] = 'engagement_rate',
): VariantComparison {
	const warnings: string[] = [];
	if (left.platform !== right.platform)
		return {
			status: 'NOT_COMPARABLE',
			metric,
			valueA: null,
			valueB: null,
			summary: 'Plataformas diferentes: não há comparação válida.',
			warnings: ['PLATFORM_MISMATCH'],
		};
	const startA = Date.parse(left.periodStart);
	const startB = Date.parse(right.periodStart);
	const endA = Date.parse(left.periodEnd);
	const endB = Date.parse(right.periodEnd);
	const durationA = endA - startA;
	const durationB = endB - startB;
	if (
		!Number.isFinite(durationA) ||
		!Number.isFinite(durationB) ||
		durationA <= 0 ||
		durationB <= 0
	)
		return {
			status: 'NOT_COMPARABLE',
			metric,
			valueA: null,
			valueB: null,
			summary: 'Períodos de coleta inválidos.',
			warnings: ['PERIOD_INVALID'],
		};
	if (Math.max(durationA, durationB) / Math.min(durationA, durationB) > 1.2)
		return {
			status: 'NOT_COMPARABLE',
			metric,
			valueA: null,
			valueB: null,
			summary: 'Períodos com durações diferentes: colete janelas equivalentes para comparar.',
			warnings: ['PERIOD_LENGTH_MISMATCH'],
		};
	if (startA !== startB || endA !== endB) warnings.push('DIFFERENT_WINDOWS');
	if (Math.abs(startA - startB) > 7 * 24 * 60 * 60 * 1000) warnings.push('DISTANT_WINDOWS');
	const valueA = metricValue(left, metric);
	const valueB = metricValue(right, metric);
	if (left.views === null || right.views === null)
		return {
			status: 'INSUFFICIENT',
			metric,
			valueA,
			valueB,
			summary: 'Views ausentes: insuficiente para qualquer conclusão.',
			warnings: [...warnings, 'VIEWS_MISSING'],
		};
	if (left.views < LOW_SAMPLE_VIEWS || right.views < LOW_SAMPLE_VIEWS)
		return {
			status: 'INSUFFICIENT',
			metric,
			valueA,
			valueB,
			summary: 'Amostra baixa (<1000 views): insuficiente para conclusão.',
			warnings: [...warnings, 'LOW_SAMPLE'],
		};
	if (Math.min(left.views, right.views) / Math.max(left.views, right.views) < 0.5)
		warnings.push('SAMPLE_IMBALANCE');
	if (valueA === null || valueB === null)
		return {
			status: 'INSUFFICIENT',
			metric,
			valueA,
			valueB,
			summary: 'Métrica ausente em uma das variantes: insuficiente para conclusão.',
			warnings: [...warnings, 'METRIC_MISSING'],
		};
	const definition = RETENTION_METRIC_DEFINITIONS.find((entry) => entry.id === metric)!;
	const higher = valueA === valueB ? null : valueA > valueB ? 'A' : 'B';
	return {
		status: 'OBSERVATIONAL',
		metric,
		valueA,
		valueB,
		summary:
			higher === null
				? `${definition.label}: valores observados iguais.`
				: `${definition.label}: a variante ${higher} teve maior valor observado (${higher === 'A' ? valueA : valueB} vs ${higher === 'A' ? valueB : valueA}). Associação descritiva, não causalidade.`,
		warnings,
	};
}

export function parseCsvRows(input: string): string[][] {
	if (input.length > 5_000_000)
		throw new RetentionError('RETENTION_CSV_TOO_LARGE', 'CSV excede 5 MB.');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index];
		if (quoted) {
			if (character === '"') {
				if (input[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else quoted = false;
			} else cell += character;
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === ',') {
			row.push(cell);
			cell = '';
		} else if (character === '\n') {
			row.push(cell.replace(/\r$/, ''));
			rows.push(row);
			row = [];
			cell = '';
		} else cell += character;
	}
	if (cell.length || row.length) {
		row.push(cell.replace(/\r$/, ''));
		rows.push(row);
	}
	if (rows.length > 5_001)
		throw new RetentionError('RETENTION_CSV_TOO_MANY_ROWS', 'CSV excede 5000 linhas.');
	return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

function nullableNumber(value: string | undefined): number | null {
	if (value === undefined || value.trim() === '' || value.trim().toLowerCase() === 'null')
		return null;
	const parsed = Number(value.replace(',', '.'));
	if (!Number.isFinite(parsed))
		throw new RetentionError('RETENTION_CSV_NUMBER', 'Número inválido.');
	return parsed;
}

export function parseRetentionCsv(input: string): {
	rows: RetentionImportRow[];
	errors: Array<{ line: number; message: string }>;
} {
	const table = parseCsvRows(input);
	if (!table.length) throw new RetentionError('RETENTION_CSV_EMPTY', 'CSV vazio.');
	const header = table[0]!.map((value) => value.trim().toLowerCase());
	const required = [
		'platform',
		'url',
		'published_at',
		'label',
		'period_start',
		'period_end',
		'captured_at',
		'views',
		'likes',
		'comments',
		'shares',
		'saves',
		'followers_gained',
		'avg_watch_ms',
		'completion_pct',
		'note',
	];
	const missing = required.filter((column) => !header.includes(column));
	if (missing.length)
		throw new RetentionError(
			'RETENTION_CSV_HEADER',
			`CSV sem colunas obrigatórias: ${missing.join(', ')}.`,
		);
	const rows: RetentionImportRow[] = [];
	const errors: Array<{ line: number; message: string }> = [];
	for (const [offset, values] of table.slice(1).entries()) {
		const record = Object.fromEntries(header.map((column, index) => [column, values[index] ?? '']));
		try {
			rows.push(
				retentionImportRowSchema.parse({
					platform: String(record.platform ?? '')
						.trim()
						.toLowerCase(),
					url: record.url,
					published_at: record.published_at,
					label: record.label,
					period_start: record.period_start,
					period_end: record.period_end,
					captured_at: record.captured_at,
					views: nullableNumber(record.views),
					likes: nullableNumber(record.likes),
					comments: nullableNumber(record.comments),
					shares: nullableNumber(record.shares),
					saves: nullableNumber(record.saves),
					followers_gained: nullableNumber(record.followers_gained),
					avg_watch_ms: nullableNumber(record.avg_watch_ms),
					completion_pct: nullableNumber(record.completion_pct),
					note: record.note,
				}),
			);
		} catch (cause) {
			const message =
				cause && typeof cause === 'object' && 'issues' in cause
					? (cause as { issues: Array<{ message: string }> }).issues[0]?.message
					: 'Linha inválida.';
			errors.push({ line: offset + 2, message: message ?? 'Linha inválida.' });
		}
	}
	return { rows, errors };
}

/** Spreadsheet formula injection guard for owner-provided text. */
export function sanitizeCsvCell(value: string | number | null): string {
	if (value === null) return '';
	const text = String(value);
	if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
	if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
	return text;
}

export function retentionCsv(rows: Array<Record<string, string | number | null>>): string {
	if (!rows.length) return '';
	const header = Object.keys(rows[0]!);
	return [
		header.map(sanitizeCsvCell).join(','),
		...rows.map((row) => header.map((column) => sanitizeCsvCell(row[column] ?? null)).join(',')),
	].join('\r\n');
}
