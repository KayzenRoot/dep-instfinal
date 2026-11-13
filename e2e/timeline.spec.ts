import { expect, test } from '@playwright/test';
import path from 'node:path';

test('owner edits a versioned timeline and restores an earlier version', async ({ page }) => {
	test.setTimeout(600_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');

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
	await expect(page.getByText('v1', { exact: true })).toBeVisible();

	await page.reload();
	await expect(page.locator('.clip-card')).toHaveCount(15);
	await expect(page.locator('.clip-card').first()).toContainText('CENA 2');

	await page.getByRole('button', { name: 'Aprovar plano atual' }).click();
	await expect(page.getByText('APPROVED')).toBeVisible();

	await page.getByRole('button', { name: '↓' }).first().click();
	await page.getByRole('button', { name: 'Salvar nova versão' }).click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.getByText('v2', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Restaurar' }).last().click();
	await expect(page.getByText('Plano salvo.')).toBeVisible();
	await expect(page.getByText('v3', { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.locator('.clip-card').first()).toContainText('CENA 2');
});
