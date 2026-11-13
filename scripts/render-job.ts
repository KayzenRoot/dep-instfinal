import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createClient, type User } from '@supabase/supabase-js';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { videoEditPlanSchema } from '../src/lib/schemas/video-edit-plan.js';
import { loadEditPlanContext, validateForContext } from '../src/lib/server/video-edit-plans.js';
import { probeMedia, renderPlanToFile } from '../src/lib/server/render-compose.js';

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`missing_${name.toLowerCase()}`);
	return value;
}

function safeCode(cause: unknown): string {
	if (cause instanceof Error) {
		const match = /^[A-Z0-9_]{1,64}$/.exec(cause.message);
		if (match) return match[0];
	}
	return 'RENDER_FAILED';
}

async function main() {
	const jobId = required('RENDER_JOB_ID');
	const url =
		process.env.WORKER_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.WORKER_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('missing_supabase');
	const admin = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});
	const { data: job, error: jobError } = await admin
		.from('render_jobs')
		.select('*')
		.eq('id', jobId)
		.maybeSingle();
	if (jobError || !job) throw new Error('render_job_not_found');
	if (!['CLAIMED', 'RUNNING'].includes(job.status)) throw new Error('render_job_not_running');

	const { data: version, error: versionError } = await admin
		.from('video_edit_plan_versions')
		.select('plan')
		.eq('owner_id', job.owner_id)
		.eq('plan_id', job.plan_id)
		.eq('version', job.plan_version)
		.maybeSingle();
	if (versionError || !version) throw new Error('render_plan_version_not_found');
	const plan = videoEditPlanSchema.parse(version.plan);
	const owner = { id: job.owner_id } as User;
	const context = await loadEditPlanContext(admin, owner, job.episode_id);
	const validated = validateForContext(plan, context);
	const assets = [];
	for (const clip of validated.clips) {
		const { data: asset, error: assetError } = await admin
			.from('video_assets')
			.select('id,object_key,bucket,sha256,byte_size,duration_ms,width,height,status')
			.eq('owner_id', job.owner_id)
			.eq('id', clip.assetId)
			.maybeSingle();
		if (assetError || !asset || asset.status !== 'READY' || !asset.object_key)
			throw new Error('render_asset_not_ready');
		assets.push(asset);
	}
	const work = await mkdtemp(join(tmpdir(), `dif-render-${jobId.slice(0, 8)}-`));
	try {
		const localDir = process.env.WORKER_ASSET_DIR;
		const localPaths = new Map<string, string>();
		let r2: S3Client | null = null;
		const bucket = process.env.R2_BUCKET;
		if (localDir) {
			for (const asset of assets) localPaths.set(asset.id, join(localDir, `${asset.id}.mp4`));
		} else {
			if (!bucket) throw new Error('missing_r2_bucket');
			r2 = new S3Client({
				region: 'auto',
				endpoint: required('R2_ENDPOINT'),
				credentials: {
					accessKeyId: required('R2_ACCESS_KEY_ID'),
					secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
				},
			});
			for (const asset of assets) {
				const destination = join(work, `${asset.id}.mp4`);
				const object = await r2.send(
					new GetObjectCommand({ Bucket: bucket, Key: asset.object_key }),
				);
				if (!object.Body) throw new Error('render_asset_download_failed');
				await pipeline(
					object.Body as NodeJS.ReadableStream,
					await import('node:fs').then((fs) => fs.createWriteStream(destination)),
				);
				localPaths.set(asset.id, destination);
			}
		}
		const inputs = [];
		for (const asset of assets) {
			const path = localPaths.get(asset.id);
			if (!path) throw new Error('render_asset_missing');
			const bytes = await readFile(path);
			const digest = createHash('sha256').update(bytes).digest('hex');
			if (asset.sha256 && asset.sha256 !== digest) throw new Error('render_asset_hash_mismatch');
			if (asset.byte_size && Number(asset.byte_size) !== bytes.length)
				throw new Error('render_asset_size_mismatch');
			const probe = await probeMedia(path);
			inputs.push({
				assetId: asset.id,
				path,
				durationMs: probe.durationMs,
				width: probe.width,
				height: probe.height,
			});
		}
		const outputPath = join(work, 'output.mp4');
		const output = await renderPlanToFile({
			plan: validated,
			assets: inputs,
			outputPath,
			vhsIntensity: 1,
			timeoutMs: 600_000,
		});
		const objectKey = `renders/${job.owner_id}/${job.episode_id}/${job.id}/output.mp4`;
		const localOutput = process.env.WORKER_LOCAL_OUTPUT_DIR;
		if (localOutput) {
			await mkdir(localOutput, { recursive: true });
			await copyFile(output.path, join(localOutput, 'output.mp4'));
		} else {
			if (!r2 || !bucket) throw new Error('render_upload_unavailable');
			await r2.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: objectKey,
					Body: createReadStream(output.path),
					ContentType: 'video/mp4',
					CacheControl: 'private, no-store',
				}),
			);
		}
		const manifest = {
			schemaVersion: 1,
			jobId: job.id,
			planId: job.plan_id,
			planVersion: job.plan_version,
			bucket: localOutput ? 'local-test' : bucket,
			objectKey: localOutput ? join(localOutput, 'output.mp4') : objectKey,
			durationMs: output.durationMs,
			width: output.width,
			height: output.height,
			codec: output.codec,
			container: output.container,
			byteSize: output.byteSize,
			sha256: output.sha256,
			completedAt: new Date().toISOString(),
		};
		process.stdout.write(`${JSON.stringify(manifest)}\n`);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

main().catch((cause) => {
	process.stderr.write(`${safeCode(cause)}\n`);
	process.exitCode = 1;
});
