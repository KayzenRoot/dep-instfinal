import type { SupabaseClient } from '@supabase/supabase-js';
import {
	qualityInspectionReportSchema,
	reportStatus,
	type QualityInspectionReport,
} from '#lib/schemas/quality-report.js';

export class QualityReportError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'QualityReportError';
	}
}

export interface QualityReportRow {
	id: string;
	owner_id: string;
	job_id: string;
	episode_id: string;
	plan_id: string;
	plan_version: number;
	artifact_sha256: string;
	report_sha256: string;
	status: 'PASS' | 'WARN' | 'BLOCKED' | 'NOT_TESTED';
	report: QualityInspectionReport;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
	acknowledgement_note: string | null;
	created_at: string;
}

export async function recordQualityReport(input: {
	adminDb: SupabaseClient;
	ownerId: string;
	jobId: string;
	episodeId: string;
	planId: string;
	planVersion: number;
	artifactSha256: string;
	reportSha256: string;
	report: QualityInspectionReport;
}): Promise<{ id: string; reportSha256: string; status: QualityReportRow['status'] }> {
	const parsed = qualityInspectionReportSchema.parse(input.report);
	const status = reportStatus(parsed.checks);
	const existing = await input.adminDb
		.from('render_quality_reports')
		.select('id,report_sha256,status')
		.eq('owner_id', input.ownerId)
		.eq('job_id', input.jobId)
		.eq('artifact_sha256', input.artifactSha256)
		.maybeSingle();
	if (existing.data?.id)
		return {
			id: existing.data.id as string,
			reportSha256: existing.data.report_sha256 as string,
			status: existing.data.status as QualityReportRow['status'],
		};
	const { data, error } = await input.adminDb
		.from('render_quality_reports')
		.insert({
			owner_id: input.ownerId,
			job_id: input.jobId,
			episode_id: input.episodeId,
			plan_id: input.planId,
			plan_version: input.planVersion,
			artifact_sha256: input.artifactSha256,
			report_sha256: input.reportSha256,
			status,
			report: parsed,
		})
		.select('id')
		.single();
	if (error || !data?.id)
		throw new QualityReportError(
			500,
			'QUALITY_REPORT_SAVE_FAILED',
			'Não foi possível salvar o relatório de qualidade.',
		);
	return { id: data.id as string, reportSha256: input.reportSha256, status };
}

export async function loadQualityReportForJob(
	db: SupabaseClient,
	ownerId: string,
	jobId: string,
): Promise<QualityReportRow | null> {
	const { data, error } = await db
		.from('render_quality_reports')
		.select(
			'id,owner_id,job_id,episode_id,plan_id,plan_version,artifact_sha256,report_sha256,status,report,acknowledged_at,acknowledged_by,acknowledgement_note,created_at',
		)
		.eq('owner_id', ownerId)
		.eq('job_id', jobId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) return null;
	const row = (data as QualityReportRow | null) ?? null;
	if (!row) return null;
	const parsed = qualityInspectionReportSchema.safeParse(row.report);
	if (!parsed.success) return null;
	return { ...row, report: parsed.data };
}

export async function acknowledgeQualityReport(input: {
	adminDb: SupabaseClient | null;
	ownerId: string;
	reportId: string;
	note: string;
}): Promise<void> {
	if (!input.adminDb)
		throw new QualityReportError(
			503,
			'QUALITY_ACK_UNAVAILABLE',
			'A confirmação de qualidade não está disponível.',
		);
	const note = input.note.trim();
	if (note.length < 8 || note.length > 1000)
		throw new QualityReportError(
			400,
			'QUALITY_ACK_INVALID',
			'A justificativa precisa ter entre 8 e 1000 caracteres.',
		);
	const { error } = await input.adminDb.rpc('acknowledge_render_quality_report', {
		p_owner_id: input.ownerId,
		p_report_id: input.reportId,
		p_note: note,
	});
	if (!error) return;
	const message = error.message ?? '';
	if (message.includes('quality_report_not_acknowledgeable'))
		throw new QualityReportError(
			409,
			'QUALITY_ACK_NOT_ALLOWED',
			'Apenas relatórios WARN podem ser reconhecidos; BLOCKED não pode ser liberado.',
		);
	if (message.includes('quality_report_already_acknowledged'))
		throw new QualityReportError(
			409,
			'QUALITY_ACK_DUPLICATE',
			'Este relatório já foi reconhecido.',
		);
	if (message.includes('quality_acknowledgement_invalid'))
		throw new QualityReportError(
			400,
			'QUALITY_ACK_INVALID',
			'A justificativa precisa ter entre 8 e 1000 caracteres.',
		);
	throw new QualityReportError(
		503,
		'QUALITY_ACK_FAILED',
		'Não foi possível reconhecer o relatório de qualidade.',
	);
}
