import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

test('owner edits a versioned timeline and restores an earlier version', async ({ page }) => {
	test.setTimeout(600_000);
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

	await page.goto(`/app/video?episodeId=${episodeId}`);
	const fixture = path.join(process.cwd(), 'e2e/fixtures/synthetic-scene.mp4');
	await page
		.getByLabel('Arquivos de vídeo')
		.setInputFiles(Array.from({ length: 15 }, () => fixture));
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
	await page.waitForTimeout(1_000);
	await page.getByRole('button', { name: 'Renderizar plano aprovado' }).click();
	await expect(page.getByText(/QUEUED|CLAIMED|RUNNING/)).toBeVisible();

	const worker = spawn(process.execPath, [path.join(process.cwd(), 'scripts/render-worker.mjs')], {
		env: {
			...process.env,
			WORKER_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL!,
			WORKER_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
			WORKER_STUB: '1',
			WORKER_MAX_JOBS: '1',
			WORKER_POLL_MS: '250',
			WORKER_LEASE_SECONDS: '30',
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
	await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 30_000 });
	const exitCode = await workerExit;
	expect(exitCode, workerOutput).toBe(0);

	await page.waitForTimeout(1_000);
	await page.getByRole('button', { name: 'Renderizar plano aprovado' }).click();
	await expect(page.getByText('QUEUED', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancelar' }).first().click();
	await expect(page.getByText('CANCELED', { exact: true })).toBeVisible();
});
