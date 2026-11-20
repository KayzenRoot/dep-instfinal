import { expect, test } from '@playwright/test';
import { insertEpisodeHierarchy, loginAsOwner } from './fixtures.js';
import { captureResponsivePages } from './responsive.js';
import { insertRow, ownerAccessToken, ownerId, serviceKey, supabaseUrl } from './supabase.js';

test('two series keep distinct style bibles, overrides stay local and import is draft-only', async ({
	page,
	request,
}) => {
	test.setTimeout(300_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(!supabaseUrl || !serviceKey || !ownerId, 'requires local service role and owner id');
	page.setDefaultTimeout(60_000);
	page.setDefaultNavigationTimeout(120_000);

	const suffix = crypto.randomUUID().slice(0, 8);
	const token = await ownerAccessToken(request);
	const seriesA = await insertEpisodeHierarchy(request, {
		token,
		suffix: `${suffix}-a`,
		seriesTitle: `Arquivo Alfa ${suffix}`,
		premise: 'Série de arquivo analógico.',
		seasonTitle: 'Temporada alfa',
		plannedEpisodeCount: 10,
		episodeNumber: 1,
		episodeTitle: `Fita alfa ${suffix}`,
		durationMs: 90_000,
	});
	const seriesB = await insertEpisodeHierarchy(request, {
		token,
		suffix: `${suffix}-b`,
		seriesTitle: `Sinal Beta ${suffix}`,
		premise: 'Série de transmissão vhs.',
		seasonTitle: 'Temporada beta',
		plannedEpisodeCount: 10,
		episodeNumber: 1,
		episodeTitle: `Fita beta ${suffix}`,
		durationMs: 90_000,
	});
	const longSeries = await insertEpisodeHierarchy(request, {
		token,
		suffix: `${suffix}-long`,
		seriesTitle: `Arquivo ${suffix} ${'registro-'.repeat(8)}`,
		premise: 'Série de teste para títulos longos em selects estreitos.',
		seasonTitle: `Temporada ${'extensa-'.repeat(6)}`,
		plannedEpisodeCount: 10,
		episodeNumber: 1,
		episodeTitle: `Episódio ${'narrado-'.repeat(10)}`,
		durationMs: 90_000,
	});
	for (const episodeId of [seriesA.episodeId, seriesB.episodeId]) {
		await insertRow(request, token, 'scenes', {
			owner_id: ownerId,
			episode_id: episodeId,
			scene_index: 1,
			start_ms: 0,
			end_ms: 8_000,
		});
	}

	await loginAsOwner(page);
	const seriesUrl = (seriesId: string, episodeId: string) =>
		`/app/style?scopeType=SERIES&scopeId=${seriesId}&episodeId=${episodeId}`;
	const waitHydrated = () =>
		expect(page.getByTestId('style-hydrated')).toHaveAttribute('data-hydrated', 'true');
	const openStyle = async (url: string) => {
		await page.goto(url);
		await waitHydrated();
	};

	// Series A: mono, horror captions, VHS color and its own CTA.
	await openStyle(seriesUrl(seriesA.seriesId, seriesA.episodeId));
	await expect(page.getByRole('heading', { name: 'Estilo da série' })).toBeVisible();
	const alphaForm = page.locator('form.style-form').first();
	await alphaForm.locator('input[name="name"]').fill(`Alfa ${suffix}`);
	await alphaForm.locator('input[name="paletteAccent"]').fill('#ff0000');
	await alphaForm.locator('select[name="colorPresetId"]').selectOption('vhs_1987');
	await alphaForm.locator('select[name="fontFamily"]').selectOption('mono');
	await alphaForm.locator('select[name="captionTemplate"]').selectOption('horror');
	await alphaForm.locator('input[name="ctaPrompt"]').fill('Comente A');
	await expect(alphaForm.locator('select[name="fontFamily"]')).toHaveValue('mono');
	await expect(alphaForm.locator('select[name="captionTemplate"]')).toHaveValue('horror');
	await expect(page.locator('.live-preview')).toHaveClass(/font-mono/);
	await alphaForm.getByRole('button', { name: 'Criar preset DRAFT' }).click();
	await expect(page.locator('.notice.success')).toContainText('Preset salvo como DRAFT');
	await page.getByRole('button', { name: 'Aprovar' }).first().click();
	await expect(page.locator('.notice.success')).toContainText('Preset aprovado');
	const exportHref = await page
		.locator('.revision .actions a', { hasText: 'JSON' })
		.first()
		.getAttribute('href');
	expect(exportHref).toMatch(/\/api\/style\//);
	const exportUrl = new URL(exportHref!, page.url()).toString();

	const alphaPreview = page.locator('.effective-preview');
	await expect(alphaPreview).toHaveClass(/font-mono/);
	await expect(alphaPreview).toContainText('Comente A');
	expect(await alphaPreview.getAttribute('style')).toContain('--accent:#ff0000');

	// Series B stays visually independent.
	await openStyle(seriesUrl(seriesB.seriesId, seriesB.episodeId));
	await expect(page.getByRole('heading', { name: 'Estilo da série' })).toBeVisible();
	await page.waitForTimeout(1500);
	const betaForm = page.locator('form.style-form').first();
	await betaForm.locator('input[name="name"]').fill(`Beta ${suffix}`);
	await betaForm.locator('input[name="paletteAccent"]').fill('#00ff00');
	await betaForm.locator('select[name="fontFamily"]').selectOption('serif');
	await betaForm.locator('select[name="captionTemplate"]').selectOption('clean');
	await betaForm.locator('input[name="ctaPrompt"]').fill('Comente B');
	await betaForm.getByRole('button', { name: 'Criar preset DRAFT' }).click();
	await expect(page.locator('.notice.success')).toContainText('Preset salvo como DRAFT');
	await page.getByRole('button', { name: 'Aprovar' }).first().click();
	await expect(page.locator('.notice.success')).toContainText('Preset aprovado');
	const betaPreview = page.locator('.effective-preview');
	await expect(betaPreview).toHaveClass(/font-serif/);
	await expect(betaPreview).toContainText('Comente B');
	expect(await betaPreview.getAttribute('style')).toContain('--accent:#00ff00');

	// Opening the scope without an episode defaults the preview to that scope.
	await openStyle(`/app/style?scopeType=SERIES&scopeId=${seriesB.seriesId}`);
	await expect(page.locator('.effective-preview')).toContainText('Comente B');
	await expect(page.locator('.effective-preview')).toHaveClass(/font-serif/);

	// Episode override wins over the series without editing the preset.
	await openStyle(seriesUrl(seriesA.seriesId, seriesA.episodeId));
	const episodePanel = page
		.locator('section.panel')
		.filter({ has: page.getByRole('heading', { name: 'Override do episódio' }) });
	await episodePanel.locator('select[name="captionTemplate"]').selectOption('clean');
	await episodePanel.getByRole('button', { name: 'Salvar override do episódio' }).click();
	await expect(page.locator('.notice.success')).toContainText('Override do episódio salvo');
	await waitHydrated();
	await expect(page.locator('.effective-preview')).toContainText('Comente A');
	await expect(page.locator('.effective-preview small')).toContainText('clean');

	// Scene override adds only the scene layer to the frozen snapshot.
	const scenePanel = page
		.locator('section.panel')
		.filter({ has: page.getByRole('heading', { name: 'Override da cena' }) });
	await scenePanel.locator('select[name="captionSafeZone"]').selectOption('feed');
	await scenePanel.getByRole('button', { name: 'Salvar override da cena' }).click();
	await expect(page.locator('.notice.success')).toContainText('Override da cena salvo');
	await waitHydrated();
	await page.locator('.scene-snapshot summary').click();
	await expect(page.locator('.scene-snapshot')).toContainText('feed');
	await expect(page.locator('.scene-snapshot')).toContainText('clean');

	// Export carries validated config only; the series preset keeps horror/tiktok.
	const exported = await page.request.get(exportUrl);
	expect(exported.status()).toBe(200);
	const payload = (await exported.json()) as {
		format: string;
		name: string;
		config: { captionTemplate: string; captionSafeZone: string; ctaPrompt: string };
	};
	expect(payload.format).toBe('dif-studio-style-preset/v1');
	expect(payload.config.captionTemplate).toBe('horror');
	expect(payload.config.captionSafeZone).toBe('tiktok');
	expect(payload.config.ctaPrompt).toBe('Comente A');
	const raw = JSON.stringify(payload);
	expect(raw).not.toContain('http');
	expect(raw).not.toContain('supabase');
	expect(raw).not.toContain('secret');
	const anonymous = await request.get(exportUrl);
	expect([401, 403, 404]).toContain(anonymous.status());

	// Importing A into B creates an unapproved draft and cannot change B's live style.
	await openStyle(seriesUrl(seriesB.seriesId, seriesB.episodeId));
	await page.locator('textarea[name="json"]').fill(JSON.stringify(payload));
	await page.getByRole('button', { name: 'Importar como DRAFT' }).click();
	await expect(page.locator('.notice.success')).toContainText('Preset importado como DRAFT');
	await expect(page.locator('.revision')).toHaveCount(3);
	await expect(page.locator('.effective-preview')).toContainText('Comente B');
	await expect(page.locator('.effective-preview')).toHaveClass(/font-serif/);

	// An entirely empty sparse form clears the episode override back to the series.
	await openStyle(seriesUrl(seriesA.seriesId, seriesA.episodeId));
	const clearPanel = page
		.locator('section.panel')
		.filter({ has: page.getByRole('heading', { name: 'Override do episódio' }) });
	await clearPanel.getByRole('button', { name: 'Limpar override' }).click();
	await expect(page.locator('.notice.success')).toContainText('Override do episódio removido');
	await expect(page.locator('.effective-preview small')).toContainText('horror');

	// Long episode titles must not widen the timeline picker at narrow widths.
	await page.setViewportSize({ width: 360, height: 900 });
	await page.goto(`/app/timeline?episodeId=${longSeries.episodeId}`);
	const timelineFits = await page.evaluate(
		() => document.documentElement.scrollWidth <= window.innerWidth,
	);
	expect(timelineFits, 'timeline should not overflow at 360px').toBe(true);

	await captureResponsivePages(page, {
		url: seriesUrl(seriesA.seriesId, seriesA.episodeId),
		heading: 'Estilo da série',
		prefix: 'style',
	});
});
