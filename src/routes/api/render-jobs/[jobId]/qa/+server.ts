import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getRenderJob } from '#lib/server/render-jobs.js';
import { loadQualityReportForJob } from '#lib/server/quality-reports.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const job = await getRenderJob({ db, owner, jobId: event.params.jobId }).catch(() => null);
	if (!job) return json({ error: 'RENDER_JOB_NOT_FOUND' }, { status: 404 });
	const report = await loadQualityReportForJob(db, owner.id, job.id);
	if (!report) return json({ error: 'QUALITY_REPORT_MISSING' }, { status: 404 });
	const durationMs = report.report.artifact.durationMs;
	const manifest = job.output_manifest ?? {};
	const cta = manifest.cta as { startMs?: number; endMs?: number } | null | undefined;
	const frames = [0.08, 0.3, 0.5, 0.7].map((ratio) => ({
		timeMs: Math.round(durationMs * ratio),
		label: `frame ${Math.round(ratio * 100)}%`,
	}));
	if (cta?.startMs !== undefined) frames.push({ timeMs: cta.startMs, label: 'início da CTA' });
	return json(
		{
			schemaVersion: 1,
			jobId: job.id,
			episodeId: job.episode_id,
			planVersion: job.plan_version,
			artifactSha256: report.artifact_sha256,
			status: report.status,
			acknowledgedAt: report.acknowledged_at,
			acknowledgementNote: report.acknowledgement_note,
			report: report.report,
			humanChecklist: {
				note: 'Checklist humano; o Quality Inspector não substitui revisão visual e auditiva no aparelho.',
				frames,
				items: [
					'Assistir ao MP4 inteiro no aparelho de referência.',
					'Confirmar CTA de duas escolhas legível e não cortada.',
					'Conferir legendas e safe zones nas cenas escuras.',
					'Ouvir narração, música e SFX sem clipping perceptível.',
					'Comparar o SHA-256 do arquivo baixado com o laudo.',
				],
			},
		},
		{
			headers: {
				'cache-control': 'private, no-store',
				'content-disposition': `attachment; filename="dif-${job.id.slice(0, 8)}-qa.json"`,
			},
		},
	);
};
