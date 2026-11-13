import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function cancelOpenRenderJobs(
	request: import('@playwright/test').APIRequestContext,
): Promise<void> {
	const base = process.env.PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!base || !key) return;
	const response = await request.patch(
		`${base}/rest/v1/render_jobs?status=in.(QUEUED,CLAIMED,RUNNING)`,
		{
			headers: {
				apikey: key,
				Authorization: `Bearer ${key}`,
				'content-type': 'application/json',
				Prefer: 'return=minimal',
			},
			data: {
				status: 'CANCELED',
				finished_at: new Date().toISOString(),
				lease_owner: null,
				lease_expires_at: null,
				heartbeat_at: null,
			},
		},
	);
	expect(response.ok()).toBeTruthy();
}

test('owner edits a versioned timeline and restores an earlier version', async ({
	page,
	request,
}) => {
	test.setTimeout(1_500_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(
		!process.env.SUPABASE_SERVICE_ROLE_KEY,
		'requires local service role for revision fixture',
	);

	const seriesTitle = `Timeline E2E ${crypto.randomUUID().slice(0, 8)}`;
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);

	await page.getByLabel('Título', { exact: true }).fill(seriesTitle);
	await page.getByRole('button', { name: /Abrir novo arquivo/ }).click();
	await expect(page).toHaveURL(/\/app\/series\/[0-9a-f-]+$/);
	await page.getByLabel('Número', { exact: true }).fill('1');
	await page.getByLabel('Episódios planejados').fill('10');
	await page.getByLabel('Título', { exact: true }).nth(1).fill('Temporada timeline');
	await page.getByRole('button', { name: 'Adicionar temporada' }).click();
	await expect(page.getByText('Temporada timeline')).toBeVisible();

	await page.getByPlaceholder('Título do episódio').fill('Episódio timeline');
	await page.getByLabel('Duração', { exact: true }).fill('120');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const episodeId = page.url().split('/').at(-1)!;

	const narrationText = [
		'A fita chegou às três e dezessete da manhã, sem remetente e sem explicação.',
		'Alice reconheceu a própria voz antes mesmo de apertar o play.',
		'Uma sombra atravessou o corredor e parou diante da porta trancada.',
		'Então ela descobriu que a gravação fora feita três dias depois daquele instante.',
		'O alarme tocou duas vezes e o silêncio voltou mais pesado do que antes.',
		'No fundo do porão, cento e quarenta e sete fitas esperavam pelo mesmo nome.',
		'A voz sussurrou que ninguém deveria abrir a caixa azul.',
		'Mesmo assim, Alice abriu.',
	].join(' ');
	await page.getByLabel('Narração completa · português brasileiro').fill(narrationText);
	await page.getByRole('button', { name: 'Salvar roteiro e revisar timeline' }).click();
	await page.waitForLoadState('networkidle');

	const renderRoot = await mkdtemp(path.join(tmpdir(), 'dif-e2e-render-'));
	const fixtures: string[] = [];
	for (let index = 1; index <= 15; index += 1) {
		const directory = path.join(renderRoot, `scene-${String(index).padStart(2, '0')}`);
		await mkdir(directory, { recursive: true });
		const fixture = path.join(directory, 'synthetic-scene.mp4');
		execFileSync(
			'ffmpeg',
			[
				'-y',
				'-hide_banner',
				'-loglevel',
				'error',
				'-f',
				'lavfi',
				'-i',
				'testsrc2=size=180x320:rate=30:duration=8',
				'-c:v',
				'libx264',
				'-preset',
				'ultrafast',
				'-pix_fmt',
				'yuv420p',
				fixture,
			],
			{ stdio: 'ignore', timeout: 60_000, windowsHide: true },
		);
		fixtures.push(fixture);
	}
	const voicePath = path.join(renderRoot, 'narration.wav');
	execFileSync(
		'ffmpeg',
		[
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=300:sample_rate=48000:duration=118',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
			voicePath,
		],
		{ stdio: 'ignore', timeout: 60_000, windowsHide: true },
	);

	await page.goto(`/app/video?episodeId=${episodeId}`);
	await page.getByLabel('Arquivos de vídeo').setInputFiles(fixtures);
	await expect(page.getByText('synthetic-scene.mp4')).toHaveCount(15);
	await page.getByRole('button', { name: 'Enviar clipes' }).click();
	await expect(page.locator('.asset-card')).toHaveCount(15, { timeout: 300_000 });

	await page.goto(`/app/timeline?episodeId=${episodeId}`);
	await expect(page.getByRole('heading', { name: 'Timeline canônica' })).toBeVisible();
	await expect(page.locator('.clip-card')).toHaveCount(15);
	await expect(page.locator('.clip-card').first()).toContainText('CENA 1');
	await expect(page.getByText('120000 ms / 120000 ms')).toBeVisible();

	await page.getByRole('button', { name: '↓' }).first().click();
	await expect(page.locator('.clip-card').first()).toContainText('CENA 2');
	await page.getByRole('button', { name: 'Salvar nova versão' }).click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.locator('.notice.error')).toHaveCount(0);
	await expect(page.getByText('v1', { exact: true })).toBeVisible();

	const stale = await page.request.post('/app/timeline?/restore', {
		headers: { origin: 'http://127.0.0.1:4173' },
		form: { episodeId, version: '1', expectedVersion: '2' },
	});
	expect(stale.status()).toBe(409);

	await page.goto(`/app/timeline?episodeId=${episodeId}`);
	await expect(page.locator('.clip-card')).toHaveCount(15);
	await expect(page.locator('.clip-card').first()).toContainText('CENA 2');

	await page.getByRole('button', { name: 'Aprovar plano atual' }).click();
	await expect(page.getByText('APPROVED')).toBeVisible();
	await expect(page.locator('.notice.error')).toHaveCount(0);

	await page.getByRole('button', { name: '↓' }).first().click();
	await page.getByRole('button', { name: 'Salvar nova versão' }).click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.locator('.notice.error')).toHaveCount(0);
	await expect(page.getByText('v2', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Restaurar' }).last().click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.locator('.notice.error')).toHaveCount(0);
	await expect(page.getByText('v3', { exact: true })).toBeVisible();
	await page.goto(`/app/timeline?episodeId=${episodeId}`);
	await expect(page.locator('.clip-card').first()).toContainText('CENA 2');

	await page.goto(`/app/episodes/${episodeId}`);
	await page.getByRole('button', { name: 'Salvar roteiro e revisar timeline' }).click();
	await page.waitForLoadState('networkidle');
	await page.goto(`/app/timeline?episodeId=${episodeId}`);
	await expect(page.getByText(/preso a uma revisão anterior/)).toBeVisible();
	await page.getByRole('button', { name: 'Aprovar plano atual' }).click();
	await expect(page.locator('.notice.error')).toBeVisible();
	await page.getByRole('button', { name: 'Reconstruir para a revisão atual' }).click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.getByText('v4', { exact: true })).toBeVisible();
	await expect(page.getByText(/preso a uma revisão anterior/)).toHaveCount(0);

	await page.getByRole('button', { name: 'Aprovar plano atual' }).click();
	await expect(page.getByText('APPROVED')).toBeVisible();

	await page.goto(`/app/narration?episodeId=${episodeId}`);
	await expect(page.getByRole('heading', { name: 'Narração e direção' })).toBeVisible();
	await page.getByRole('button', { name: 'Salvar direção' }).click();
	await expect(page.locator('.notice.success')).toContainText('versão');
	await page.locator('input[type="file"]').setInputFiles(voicePath);
	await expect(page.locator('.takes li')).toHaveCount(1, { timeout: 180_000 });
	await page.locator('input[type="radio"][name="take"]').first().check();
	await page.getByRole('button', { name: 'Aprovar direção + voz' }).click();
	await expect(page.locator('.notice.success')).toContainText('versão');
	await page
		.locator('.history li')
		.filter({ hasText: 'v1' })
		.getByRole('button', { name: 'Restaurar' })
		.click();
	await expect(page.locator('.notice.success')).toContainText('versão');
	await page.locator('input[type="radio"][name="take"]').first().check();
	await page.getByRole('button', { name: 'Aprovar direção + voz' }).click();
	await expect(page.locator('.notice.success')).toContainText('versão');
	const takesResponse = await page.request.get(`/api/narration/takes?episodeId=${episodeId}`);
	expect(takesResponse.ok()).toBeTruthy();
	const { takes } = (await takesResponse.json()) as { takes: Array<{ id: string }> };
	expect(takes).toHaveLength(1);
	const narrationTakeId = takes[0]!.id;
	const narrationDir = path.join(renderRoot, 'narration');
	await mkdir(narrationDir, { recursive: true });
	await copyFile(voicePath, path.join(narrationDir, `${narrationTakeId}.wav`));

	await page.goto(`/app/timeline?episodeId=${episodeId}`);
	await expect(page.getByText(/Narração aprovada/)).toBeVisible();
	await page.waitForTimeout(1_000);
	await cancelOpenRenderJobs(request);
	await page.getByRole('button', { name: 'Renderizar plano aprovado' }).click();
	await expect(page.getByText(/QUEUED|CLAIMED|RUNNING/)).toBeVisible();

	const assetResponse = await page.request.get(`/api/video/assets?episodeId=${episodeId}`);
	expect(assetResponse.ok()).toBeTruthy();
	const { assets } = (await assetResponse.json()) as { assets: Array<{ id: string }> };
	expect(assets).toHaveLength(15);
	const assetDir = path.join(renderRoot, 'assets');
	await mkdir(assetDir, { recursive: true });
	for (const [index, asset] of assets.entries()) {
		await copyFile(fixtures[index]!, path.join(assetDir, `${asset.id}.mp4`));
	}
	const worker = spawn(process.execPath, [path.join(process.cwd(), 'scripts/render-worker.mjs')], {
		env: {
			...process.env,
			WORKER_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL!,
			WORKER_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
			WORKER_STUB: '0',
			WORKER_ASSET_DIR: assetDir,
			WORKER_NARRATION_DIR: narrationDir,
			// The 15-clip E2E exercises queue/worker/mux; VHS filter cost is covered by FFmpeg integration.
			WORKER_VHS_INTENSITY: '0',
			WORKER_LOCAL_OUTPUT_DIR: path.join(renderRoot, 'out'),
			WORKER_MAX_JOBS: '1',
			WORKER_POLL_MS: '250',
			WORKER_LEASE_SECONDS: '180',
			WORKER_ID: `e2e-${crypto.randomUUID()}`,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let workerOutput = '';
	worker.stdout?.on('data', (chunk) => (workerOutput += String(chunk)));
	worker.stderr?.on('data', (chunk) => (workerOutput += String(chunk)));
	const workerExit = new Promise<number>((resolve) =>
		worker.on('exit', (code) => resolve(code ?? 1)),
	);
	try {
		await Promise.race([
			expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 600_000 }),
			workerExit.then((code) => {
				if (code !== 0) throw new Error(`worker exited ${code}\n${workerOutput}`);
			}),
		]);
		await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 15_000 });
	} catch (cause) {
		console.error(`worker output:\n${workerOutput}`);
		throw cause;
	}
	const exitCode = await workerExit;
	expect(exitCode, workerOutput).toBe(0);
	const jobsResponse = await page.request.get(`/api/render-jobs?episodeId=${episodeId}`);
	expect(jobsResponse.ok()).toBeTruthy();
	const { jobs } = (await jobsResponse.json()) as {
		jobs: Array<{
			status: string;
			narration_take_id: string | null;
			output_manifest: {
				width: number;
				height: number;
				codec: string;
				durationMs: number;
				audio: {
					codec: string;
					channels: number;
					sampleRate: number;
					durationMs: number;
					narrationTakeId: string;
					paddedMs: number;
				} | null;
			};
		}>;
	};
	expect(jobs[0]?.status).toBe('READY');
	expect(jobs[0]?.narration_take_id).toBe(narrationTakeId);
	expect(jobs[0]?.output_manifest).toMatchObject({ width: 1080, height: 1920, codec: 'h264' });
	expect(Math.abs(jobs[0]!.output_manifest.durationMs - 120_000)).toBeLessThanOrEqual(1_000);
	expect(jobs[0]?.output_manifest.audio).toMatchObject({
		codec: 'aac',
		channels: 2,
		sampleRate: 48_000,
		narrationTakeId,
	});
	expect(jobs[0]?.output_manifest.audio?.paddedMs).toBeGreaterThanOrEqual(1_000);

	await page.waitForTimeout(1_000);
	await page.getByRole('button', { name: 'Renderizar plano aprovado' }).click();
	await expect(page.getByText('QUEUED', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancelar' }).first().click();
	await expect(page.getByText('CANCELED', { exact: true })).toBeVisible();
	await rm(renderRoot, { recursive: true, force: true });
});
