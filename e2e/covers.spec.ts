import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { insertRow, ownerAccessToken, ownerId, serviceKey, supabaseUrl } from './supabase.js';

test('owner generates, approves and downloads private covers', async ({ page, request }) => {
	test.setTimeout(300_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(!supabaseUrl || !serviceKey || !ownerId, 'requires local service role and owner id');
	page.setDefaultTimeout(60_000);
	page.setDefaultNavigationTimeout(120_000);

	const suffix = crypto.randomUUID().slice(0, 8);
	const seriesId = crypto.randomUUID();
	const seasonId = crypto.randomUUID();
	const episodeId = crypto.randomUUID();
	const token = await ownerAccessToken(request);
	await insertRow(request, token, 'series', {
		id: seriesId,
		owner_id: ownerId,
		title: `Covers E2E ${suffix}`,
		premise: 'Fixture sintética de capas.',
	});
	await insertRow(request, token, 'seasons', {
		id: seasonId,
		owner_id: ownerId,
		series_id: seriesId,
		season_number: 1,
		title: 'Temporada capas',
		planned_episode_count: 10,
	});
	await insertRow(request, token, 'episodes', {
		id: episodeId,
		owner_id: ownerId,
		season_id: seasonId,
		episode_number: 1,
		title: `Episódio capas ${suffix}`,
		duration_ms: 120_000,
	});

	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);

	await page.goto(`/app/covers?episodeId=${episodeId}`);
	await expect(page.getByRole('heading', { name: 'Capas do episódio' })).toBeVisible();
	await page.locator('input[name="title"]').fill(`A fita de ${suffix}`);
	await page.locator('select[name="format"]').selectOption('4:5');
	await page.getByRole('button', { name: 'Gerar capas' }).click();
	await expect(page.locator('.notice.success')).toContainText('3 capa(s) geradas');
	await expect(page.locator('.revision')).toHaveCount(3);

	const first = page.locator('.revision').first();
	const revisionId = await first.getAttribute('data-revision-id');
	expect(revisionId).toBeTruthy();
	const preview = await page.request.get(`/api/covers/${revisionId}?format=4:5`);
	expect(preview.status()).toBe(200);
	expect(preview.headers()['content-type']).toContain('image/png');
	const metadata = await sharp(Buffer.from(await preview.body())).metadata();
	expect(metadata.width).toBe(1080);
	expect(metadata.height).toBe(1350);

	await first.getByRole('button', { name: 'Aprovar' }).click();
	await expect(page.locator('.notice.success')).toContainText('Capa aprovada na versão 4');
	await expect(page.locator('.revision').first()).toContainText('APPROVED');

	const download = await page.request.get(
		`/api/covers/${revisionId}?format=4:5&output=jpeg&download=1`,
	);
	expect(download.status()).toBe(200);
	expect(download.headers()['content-type']).toContain('image/jpeg');
	const zip = await page.request.get(`/api/covers/${revisionId}?format=zip&download=1`);
	expect(zip.status()).toBe(200);
	expect(zip.headers()['content-type']).toContain('application/zip');

	await page.setViewportSize({ width: 360, height: 900 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});
