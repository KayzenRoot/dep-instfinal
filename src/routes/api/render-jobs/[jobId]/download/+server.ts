import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { getRenderJob } from '#lib/server/render-jobs.js';
import { loadQualityReportForJob } from '#lib/server/quality-reports.js';

function jsonError(status: number, code: string, message: string): Response {
	return new Response(JSON.stringify({ error: code, message }), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});
}

function manifestField<T>(manifest: Record<string, unknown>, key: string): T | null {
	const value = manifest[key];
	return value === undefined || value === null ? null : (value as T);
}

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const job = await getRenderJob({ db, owner, jobId: event.params.jobId }).catch(() => null);
	if (!job) return jsonError(404, 'RENDER_JOB_NOT_FOUND', 'Render não encontrado.');
	if (job.status !== 'READY' || !job.output_manifest)
		return jsonError(409, 'RENDER_NOT_READY', 'O render ainda não está pronto para download.');

	const report = await loadQualityReportForJob(db, owner.id, job.id);
	if (!report)
		return jsonError(
			409,
			'QUALITY_REPORT_MISSING',
			'Este render não tem relatório de qualidade; gere novamente.',
		);
	if (report.status === 'BLOCKED')
		return jsonError(
			409,
			'QUALITY_BLOCKED',
			'O Quality Inspector bloqueou este artefato; corrija e renderize novamente.',
		);
	if (report.status === 'NOT_TESTED')
		return jsonError(
			409,
			'QUALITY_NOT_TESTED',
			'O Quality Inspector não conseguiu validar este artefato; gere novamente.',
		);
	if (report.status === 'WARN' && !report.acknowledged_at)
		return jsonError(
			409,
			'QUALITY_ACK_REQUIRED',
			'Reconheça os avisos de qualidade com uma justificativa antes do download.',
		);

	const manifest = job.output_manifest;
	const bucket = manifestField<string>(manifest, 'bucket');
	const objectKey = manifestField<string>(manifest, 'objectKey');
	const byteSize = manifestField<number>(manifest, 'byteSize');
	const sha256 = manifestField<string>(manifest, 'sha256');
	if (!bucket || !objectKey || !byteSize || !sha256)
		return jsonError(409, 'RENDER_MANIFEST_INVALID', 'O manifesto do render está incompleto.');
	if (report.artifact_sha256 !== sha256)
		return jsonError(
			409,
			'QUALITY_REPORT_MISMATCH',
			'O relatório de qualidade pertence a outro artefato.',
		);

	let body: ReadableStream;
	if (bucket === 'local-test') {
		if (process.env.NODE_ENV === 'production')
			return jsonError(404, 'RENDER_ARTIFACT_NOT_FOUND', 'Artefato local indisponível.');
		const path = resolve(objectKey);
		const information = await stat(path).catch(() => null);
		if (!information || !information.isFile() || information.size !== byteSize)
			return jsonError(
				409,
				'RENDER_ARTIFACT_MISMATCH',
				'O artefato local não confere com o manifesto.',
			);
		body = Readable.toWeb(createReadStream(path)) as ReadableStream;
	} else {
		const config = getAppConfig();
		if (
			!config.r2AccountId ||
			!config.r2AccessKeyId ||
			!config.r2SecretAccessKey ||
			!config.r2Endpoint
		)
			return jsonError(
				503,
				'RENDER_STORAGE_UNAVAILABLE',
				'O armazenamento privado não está disponível.',
			);
		const client = new S3Client({
			region: 'auto',
			endpoint: config.r2Endpoint,
			forcePathStyle: true,
			credentials: {
				accessKeyId: config.r2AccessKeyId,
				secretAccessKey: config.r2SecretAccessKey,
			},
		});
		const head = await client
			.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }))
			.catch(() => null);
		if (
			!head ||
			head.ContentLength !== byteSize ||
			head.Metadata?.sha256 !== sha256 ||
			head.Metadata?.plan !== report.report.planSha256
		)
			return jsonError(
				409,
				'RENDER_ARTIFACT_MISMATCH',
				'O artefato privado não confere com o manifesto.',
			);
		const object = await client
			.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
			.catch(() => null);
		if (!object?.Body)
			return jsonError(
				503,
				'RENDER_STORAGE_UNAVAILABLE',
				'Não foi possível ler o artefato privado.',
			);
		body = Readable.toWeb(object.Body as Readable) as ReadableStream;
	}

	const fileName = `dif-episode-${job.episode_id.slice(0, 8)}-v${job.plan_version}-${job.id.slice(0, 8)}.mp4`;
	return new Response(body, {
		headers: {
			'content-type': 'video/mp4',
			'content-length': String(byteSize),
			'content-disposition': `attachment; filename="${fileName}"`,
			'cache-control': 'private, no-store',
			'x-content-sha256': sha256,
			'x-quality-status': report.status,
		},
	});
};
