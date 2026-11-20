import { expect, test } from '@playwright/test';
import { insertEpisodeHierarchy, loginAsOwner } from './fixtures.js';
import { captureResponsivePages } from './responsive.js';
import { ownerAccessToken, ownerId, serviceKey, supabaseUrl } from './supabase.js';

test('owner records, imports, compares and deletes retention data', async ({ page, request }) => {
	test.setTimeout(300_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(!supabaseUrl || !serviceKey || !ownerId, 'requires local service role and owner id');
	page.setDefaultTimeout(60_000);
	page.setDefaultNavigationTimeout(120_000);
	page.on('dialog', (dialog) => void dialog.accept());

	const suffix = crypto.randomUUID().slice(0, 8);
	const token = await ownerAccessToken(request);
	const { episodeId } = await insertEpisodeHierarchy(request, {
		token,
		suffix,
		seriesTitle: `Retention E2E ${suffix}`,
		premise: 'Fixture sintética de retenção.',
		seasonTitle: 'Temporada retenção',
		plannedEpisodeCount: 10,
		episodeNumber: 2,
		episodeTitle: `Episódio retenção ${suffix}`,
		durationMs: 90_000,
	});

	await loginAsOwner(page);
	await page.getByRole('link', { name: 'Retenção' }).click();
	await expect(page).toHaveURL(/\/app\/retention/);
	await page.locator('select[name="episodeId"]').selectOption(episodeId);
	await expect(page.getByRole('heading', { name: 'Laboratório de retenção' })).toBeVisible();

	const postForm = page.locator('form[action="?/post"]');
	await postForm.locator('input[name="publishedAt"]').fill('2026-11-01T10:00');
	await postForm.locator('input[name="url"]').fill('https://www.tiktok.com/@dif/video/1001');
	await postForm.locator('input[name="label"]').fill('Abertura A');
	await postForm.getByRole('button', { name: 'Salvar publicação' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');
	await expect(page.locator('.post-card')).toHaveCount(1);

	async function addPost(url: string, label: string, platform = 'tiktok') {
		await postForm.locator('input[name="publishedAt"]').fill('2026-11-01T10:00');
		await postForm.locator('select[name="platform"]').selectOption(platform);
		await postForm.locator('input[name="url"]').fill(url);
		await postForm.locator('input[name="label"]').fill(label);
		await postForm.getByRole('button', { name: 'Salvar publicação' }).click();
		await expect(page.locator('.notice.success')).toContainText('Registro salvo');
	}

	await page
		.locator('details')
		.filter({ hasText: 'Registrar variante' })
		.locator('summary')
		.click();
	const variantForm = page.locator('form[action="?/variant"]');
	await variantForm.locator('select[name="postId"]').selectOption({ label: 'tiktok · Abertura A' });
	await variantForm.locator('select[name="kind"]').selectOption('HOOK');
	await variantForm.locator('input[name="label"]').fill('H1');
	await variantForm.getByRole('button', { name: 'Salvar variante' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');

	await addPost('https://www.instagram.com/reel/ABC123/', 'Abertura B', 'reels');
	await expect(page.locator('.post-card')).toHaveCount(2);
	await page
		.locator('details')
		.filter({ hasText: 'Registrar variante' })
		.locator('summary')
		.click();
	await variantForm.locator('select[name="postId"]').selectOption({ label: 'reels · Abertura B' });
	await variantForm.locator('select[name="kind"]').selectOption('BASELINE');
	await variantForm.locator('input[name="label"]').fill('B1');
	await variantForm.getByRole('button', { name: 'Salvar variante' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');

	await addPost('https://www.tiktok.com/@dif/video/1005', 'Abertura C');
	await page
		.locator('details')
		.filter({ hasText: 'Registrar variante' })
		.locator('summary')
		.click();
	await variantForm.locator('select[name="postId"]').selectOption({ label: 'tiktok · Abertura C' });
	await variantForm.locator('select[name="kind"]').selectOption('HOOK');
	await variantForm.locator('input[name="label"]').fill('C1');
	await variantForm.getByRole('button', { name: 'Salvar variante' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');

	async function addSnapshot(postLabel: string, views: string, likes: string, completion: string) {
		await page
			.locator('details')
			.filter({ hasText: 'Adicionar snapshot manual' })
			.locator('summary')
			.click();
		const form = page.locator('form[action="?/snapshot"]');
		await form.locator('select[name="postId"]').selectOption({ label: postLabel });
		await form.locator('input[name="periodStart"]').fill('2026-11-01T00:00');
		await form.locator('input[name="periodEnd"]').fill('2026-11-08T00:00');
		await form.locator('input[name="capturedAt"]').fill('2026-11-09T00:00');
		await form.locator('input[name="views"]').fill(views);
		await form.locator('input[name="likes"]').fill(likes);
		await form.locator('input[name="comments"]').fill('50');
		await form.locator('input[name="shares"]').fill('30');
		await form.locator('input[name="saves"]').fill('20');
		await form.locator('input[name="followersGained"]').fill('10');
		await form.locator('input[name="avgWatchMs"]').fill('60000');
		await form.locator('input[name="completionPct"]').fill(completion);
		await form.getByRole('button', { name: 'Salvar snapshot' }).click();
		await expect(page.locator('.notice.success')).toContainText('Registro salvo');
	}

	await addSnapshot('tiktok · Abertura A', '12000', '600', '50');
	await addSnapshot('tiktok · Abertura C', '10000', '300', '45');
	await addSnapshot('reels · Abertura B', '9000', '200', '40');
	await expect(page.locator('.post-card').first()).toContainText('12.000');
	await expect(page.locator('.post-card').first()).toContainText('5.83%');
	await expect(page.locator('.post-card').first()).toContainText('origem MANUAL');

	const experimentForm = page.locator('form[action="?/experiment"]');
	await experimentForm.locator('input[name="name"]').fill('Hook vs baseline');
	await experimentForm
		.locator('input[name="hypothesis"]')
		.fill('Abertura curta observa mais engajamento.');
	await experimentForm
		.locator('select[name="variantAId"]')
		.selectOption({ label: 'tiktok · Abertura A · H1' });
	await experimentForm
		.locator('select[name="variantBId"]')
		.selectOption({ label: 'tiktok · Abertura C · C1' });
	await experimentForm.getByRole('button', { name: 'Registrar experimento' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');
	const observable = page.locator('.comparison').filter({ hasText: 'Hook vs baseline' });
	await expect(observable).toContainText('OBSERVATIONAL');
	await expect(observable).toContainText('maior valor observado');
	await expect(observable).not.toContainText('garantia');

	await experimentForm.locator('input[name="name"]').fill('Cross-platform');
	await experimentForm
		.locator('select[name="variantAId"]')
		.selectOption({ label: 'tiktok · Abertura A · H1' });
	await experimentForm
		.locator('select[name="variantBId"]')
		.selectOption({ label: 'reels · Abertura B · B1' });
	await experimentForm.getByRole('button', { name: 'Registrar experimento' }).click();
	await expect(page.locator('.notice.success')).toContainText('Registro salvo');
	await expect(page.locator('.comparison').filter({ hasText: 'Cross-platform' })).toContainText(
		'NOT_COMPARABLE',
	);

	await page.locator('details').filter({ hasText: 'Importar CSV' }).locator('summary').click();
	const csv = [
		'platform,url,published_at,label,period_start,period_end,captured_at,views,likes,comments,shares,saves,followers_gained,avg_watch_ms,completion_pct,note',
		`tiktok,https://www.tiktok.com/@dif/video/1003,2026-11-02T00:00:00Z,CSV A,2026-11-02T00:00:00Z,2026-11-09T00:00:00Z,2026-11-10T00:00:00Z,20000,800,60,40,20,15,60000,55,Importado`,
		`tiktok,https://www.tiktok.com/@dif/video/1004,2026-11-03T00:00:00Z,CSV B,2026-11-03T00:00:00Z,2026-11-10T00:00:00Z,2026-11-11T00:00:00Z,15000,,,,,8,,50,Sem interações`,
	].join('\n');
	await page.locator('form[action="?/import"] textarea[name="csv"]').fill(csv);
	await page.locator('form[action="?/import"] button[type="submit"]').click();
	await expect(page.locator('.notice.success')).toContainText('2 novos');
	await expect(page.locator('.post-card')).toHaveCount(5);
	await expect(page.locator('.post-card').filter({ hasText: 'CSV B' })).toContainText(
		'INDISPONÍVEL',
	);

	const exported = await page.request.get(
		`/api/retention/export?episodeId=${episodeId}&format=csv`,
	);
	expect(exported.status()).toBe(200);
	const exportedCsv = await exported.text();
	expect(exportedCsv).toContain('https://www.tiktok.com/@dif/video/1001');
	expect(exportedCsv).toContain('engagement_rate');
	const exportedJson = await page.request.get(
		`/api/retention/export?episodeId=${episodeId}&format=json`,
	);
	expect(exportedJson.status()).toBe(200);
	expect((await exportedJson.json()) as { format: string }).toMatchObject({
		format: 'dif-studio-retention/v1',
	});
	const anonymous = await request.get(`/api/retention/export?episodeId=${episodeId}&format=csv`);
	expect([401, 403, 404]).toContain(anonymous.status());

	await page
		.locator('.post-card')
		.first()
		.getByRole('button', { name: 'Remover publicação' })
		.click();
	await expect(page.locator('.post-card')).toHaveCount(4);

	await captureResponsivePages(page, {
		url: `/app/retention?episodeId=${episodeId}`,
		heading: 'Laboratório de retenção',
		prefix: 'retention',
	});
});
