import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { insertEpisodeHierarchy, loginAsOwner } from './fixtures.js';
import { captureResponsivePages } from './responsive.js';
import { ownerAccessToken, ownerId, serviceKey, supabaseUrl } from './supabase.js';

test('owner generates, approves and downloads private covers', async ({ page, request }) => {
	test.setTimeout(300_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(!supabaseUrl || !serviceKey || !ownerId, 'requires local service role and owner id');
	page.setDefaultTimeout(60_000);
	page.setDefaultNavigationTimeout(120_000);

	const suffix = crypto.randomUUID().slice(0, 8);
	const token = await ownerAccessToken(request);
	const { episodeId } = await insertEpisodeHierarchy(request, {
		token,
		suffix,
		seriesTitle: `Covers E2E ${suffix}`,
		premise: 'Fixture sintética de capas.',
		seasonTitle: 'Temporada capas',
		plannedEpisodeCount: 10,
		episodeNumber: 1,
		episodeTitle: `Episódio capas ${suffix}`,
		durationMs: 120_000,
	});

	await loginAsOwner(page);

	await page.getByRole('link', { name: 'Capas' }).click();
	await expect(page).toHaveURL(/\/app\/covers/);
	await page.locator('select[name="episodeId"]').selectOption(episodeId);
	await expect(page.locator('select[name="episodeId"]')).toHaveValue(episodeId);
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
	const anonymous = await request.get(`/api/covers/${revisionId}?format=4:5`);
	expect([401, 403, 404]).toContain(anonymous.status());

	await page.goto(`/app/episodes/${episodeId}`);
	const approvedCover = page.locator('.approved-cover img').first();
	await expect(approvedCover).toBeVisible();
	await expect
		.poll(() => approvedCover.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await captureResponsivePages(page, {
		url: `/app/covers?episodeId=${episodeId}`,
		heading: 'Capas do episódio',
		prefix: 'covers',
	});
});
