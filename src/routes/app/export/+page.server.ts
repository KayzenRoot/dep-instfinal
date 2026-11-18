import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import {
	acknowledgeQualityReport,
	QualityReportError,
	type QualityReportRow,
} from '#lib/server/quality-reports.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('episodes')
		.select(
			'id,title,episode_number,status,duration_ms,is_season_finale,seasons(title,planned_episode_count,series(title))',
		)
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível listar os episódios exportáveis.');
	const episodes = (data ?? []).map((episode) => {
		const season = firstRelation(episode.seasons);
		return {
			...episode,
			is_season_finale: Number(episode.episode_number) === Number(season?.planned_episode_count),
			seasons: season ? { ...season, series: firstRelation(season.series) } : null,
		};
	});
	const [jobsResult, reportsResult] = await Promise.all([
		db
			.from('render_jobs')
			.select(
				'id,episode_id,plan_version,status,error_code,output_manifest,output_profile,quality,created_at,finished_at',
			)
			.eq('owner_id', owner.id)
			.order('created_at', { ascending: false })
			.limit(20),
		db
			.from('render_quality_reports')
			.select(
				'id,owner_id,job_id,episode_id,plan_id,plan_version,artifact_sha256,report_sha256,status,report,acknowledged_at,acknowledged_by,acknowledgement_note,created_at',
			)
			.eq('owner_id', owner.id)
			.order('created_at', { ascending: false })
			.limit(20),
	]);
	if (jobsResult.error || reportsResult.error)
		throw new Error('Não foi possível listar os renders exportáveis.');
	const reports = new Map(
		((reportsResult.data ?? []) as QualityReportRow[]).map((report) => [report.job_id, report]),
	);
	const titles = new Map(episodes.map((episode) => [episode.id, episode.title]));
	return {
		episodes,
		renders: (jobsResult.data ?? []).map((job) => ({
			...job,
			episode_title: titles.get(job.episode_id as string) ?? 'Episódio',
			report: reports.get(job.id as string) ?? null,
		})),
	};
};

export const actions: Actions = {
	acknowledge: async (event) => {
		const { owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const reportId = String(form.get('reportId') ?? '');
		const note = String(form.get('note') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(reportId)) return fail(400, { message: 'Relatório inválido.' });
		try {
			await acknowledgeQualityReport({
				adminDb: createSupabaseAdminClient(),
				ownerId: owner.id,
				reportId,
				note,
			});
			return { success: true };
		} catch (cause) {
			if (cause instanceof QualityReportError)
				return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível reconhecer o relatório.' });
		}
	},
};
