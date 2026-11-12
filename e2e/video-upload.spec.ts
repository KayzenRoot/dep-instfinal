import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('owner uploads a scene clip to private storage and it survives reload', async ({
	page,
	request,
}) => {
	test.setTimeout(600_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');

	const seriesTitle = `Clipes E2E ${crypto.randomUUID().slice(0, 8)}`;
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
	await page.getByLabel('Título', { exact: true }).nth(1).fill('Temporada clipes');
	await page.getByRole('button', { name: 'Adicionar temporada' }).click();
	await expect(page.getByText('Temporada clipes')).toBeVisible();

	await page.getByPlaceholder('Título do episódio').fill('Episódio clipes');
	await page.getByLabel('Duração', { exact: true }).fill('120');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const episodeId = page.url().split('/').at(-1)!;

	await page.goto(`/app/video?episodeId=${episodeId}`);
	await expect(page.getByRole('heading', { name: 'Clipes do Flow' })).toBeVisible();
	const fixture = path.join(process.cwd(), 'e2e/fixtures/synthetic-scene.mp4');
	const fixtureHash = createHash('sha256').update(readFileSync(fixture)).digest('hex');
	await page
		.getByLabel('Arquivos de vídeo')
		.setInputFiles(Array.from({ length: 15 }, () => fixture));
	await expect(page.getByText('synthetic-scene.mp4')).toHaveCount(15);
	await page.getByRole('button', { name: 'Enviar clipes' }).click();
	await expect(page.locator('.asset-card')).toHaveCount(15, { timeout: 300_000 });
	await expect(page.getByText('Cena 15 · v1')).toBeVisible();
	const assetsResponse = await page.request.get(`/api/video/assets?episodeId=${episodeId}`);
	expect(assetsResponse.status()).toBe(200);
	const { assets } = (await assetsResponse.json()) as { assets: Array<{ sha256: string }> };
	expect(assets).toHaveLength(15);
	expect(new Set(assets.map((asset) => asset.sha256))).toEqual(new Set([fixtureHash]));

	const video = page.locator('video').first();
	await expect(video).toBeVisible();
	const src = await video.getAttribute('src');
	const assetId = src?.split('/').at(-1);
	expect(assetId).toMatch(/^[0-9a-f-]{36}$/i);

	const anonymous = await request.get(`/api/video/${assetId}`, { maxRedirects: 0 });
	expect([303, 401]).toContain(anonymous.status());
	expect(anonymous.headers()['cache-control']).toContain('no-store');

	await page.reload();
	await expect(page.locator('.asset-card')).toHaveCount(15);
	await expect(page.getByText('Cena 15 · v1')).toBeVisible();
});
