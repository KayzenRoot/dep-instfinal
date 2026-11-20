import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	callRpc,
	insertRow,
	ownerAccessToken,
	ownerId,
	serviceKey,
	supabaseUrl,
} from './supabase.js';

test('owner builds, approves and invalidates the two-choice end card', async ({
	page,
	request,
}) => {
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
		title: `Finale E2E ${suffix}`,
		premise: 'Fixture sintética de final A/B.',
	});
	await insertRow(request, token, 'seasons', {
		id: seasonId,
		owner_id: ownerId,
		series_id: seriesId,
		season_number: 1,
		title: 'Temporada final',
		planned_episode_count: 10,
	});
	await insertRow(request, token, 'episodes', {
		id: episodeId,
		owner_id: ownerId,
		season_id: seasonId,
		episode_number: 9,
		title: `Episódio final ${suffix}`,
		duration_ms: 90_000,
	});
	await insertRow(request, token, 'choices', {
		owner_id: ownerId,
		episode_id: episodeId,
		option_key: '1',
		label: 'ENTRAR',
		consequence: 'A personagem entra na sala.',
	});
	await insertRow(request, token, 'choices', {
		id: crypto.randomUUID(),
		owner_id: ownerId,
		episode_id: episodeId,
		option_key: '2',
		label: 'FUGIR',
		consequence: 'A personagem foge da sala.',
	});

	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);

	await page.getByRole('link', { name: 'Final A/B' }).click();
	await expect(page).toHaveURL(/\/app\/finale/);
	await page.locator('select[name="episodeId"]').selectOption(episodeId);
	await expect(page.getByRole('heading', { name: 'Final A/B do episódio' })).toBeVisible();
	await expect(page.locator('.choices-preview')).toContainText('ENTRAR');
	await expect(page.locator('.choices-preview')).toContainText('FUGIR');

	await page.locator('select[name="templateId"]').selectOption('cctv');
	await page.locator('input[name="layouts"][value="split"]').check();
	await page.locator('input[name="layouts"][value="stacked"]').check();
	await page.getByRole('button', { name: 'Gerar layouts selecionados' }).click();
	await expect(page.locator('.notice.success')).toContainText('2 layout(s)');
	await expect(page.locator('.revision')).toHaveCount(2);

	await page.locator('.revision').first().getByRole('button', { name: 'Aprovar' }).click();
	await expect(page.locator('.notice.success')).toContainText('aprovado na revisão 3');
	const approved = page.locator('.revision').first();
	await expect(approved).toContainText('APPROVED');
	const revisionId = await approved.getAttribute('data-revision-id');
	expect(revisionId).toBeTruthy();

	const ass = await page.request.get(`/api/end-cards/${revisionId}?format=ass`);
	expect(ass.status()).toBe(200);
	expect(ass.headers()['content-type']).toContain('text/plain');
	const assBody = await ass.text();
	expect(assBody).toContain('ENTRAR');
	expect(assBody).toContain('FUGIR');
	expect(assBody).toContain('Dialogue:');
	const json = await page.request.get(`/api/end-cards/${revisionId}?format=json`);
	expect(json.status()).toBe(200);
	expect((await json.json()) as { status: string }).toMatchObject({ status: 'APPROVED' });
	const wav = await page.request.get(`/api/end-cards/${revisionId}?format=wav`);
	expect(wav.status()).toBe(200);
	expect(wav.headers()['content-type']).toContain('audio/wav');
	const anonymous = await request.get(`/api/end-cards/${revisionId}?format=ass`);
	expect([401, 403, 404]).toContain(anonymous.status());

	await callRpc(request, token, 'save_episode_choices', {
		p_episode_id: episodeId,
		p_option_1_label: 'ENTRAR AGORA',
		p_option_1_consequence: 'A personagem entra na sala.',
		p_option_2_label: 'FUGIR',
		p_option_2_consequence: 'A personagem foge da sala.',
	});
	await page.goto(`/app/finale?episodeId=${episodeId}`);
	await expect(page.locator('.stale')).toHaveCount(3);
	const blocked = await page.request.get(`/api/end-cards/${revisionId}?format=ass`);
	expect(blocked.status()).toBe(409);

	const screenshotDirectory = path.join(process.cwd(), 'test-results', 'screenshots');
	await mkdir(screenshotDirectory, { recursive: true });
	for (const width of [360, 768, 1440]) {
		await page.goto(`/app/finale?episodeId=${episodeId}`);
		await page.setViewportSize({ width, height: 900 });
		await expect(page.getByRole('heading', { name: 'Final A/B do episódio' })).toBeVisible();
		const fits = await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		);
		expect(fits, `finale page should not overflow at ${width}px`).toBe(true);
		await page.screenshot({
			path: path.join(screenshotDirectory, `finale-${width}.png`),
			fullPage: true,
		});
	}
});
