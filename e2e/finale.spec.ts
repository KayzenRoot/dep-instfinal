import { expect, test } from '@playwright/test';
import { insertEpisodeHierarchy, loginAsOwner } from './fixtures.js';
import { captureResponsivePages } from './responsive.js';
import {
	callRpc,
	insertRow,
	ownerAccessToken,
	ownerId,
	serviceKey,
	supabaseUrl,
} from './supabase.js';
import { readZipTextEntry } from './zip.js';

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
	const token = await ownerAccessToken(request);
	const { episodeId } = await insertEpisodeHierarchy(request, {
		token,
		suffix,
		seriesTitle: `Finale E2E ${suffix}`,
		premise: 'Fixture sintética de final A/B.',
		seasonTitle: 'Temporada final',
		plannedEpisodeCount: 10,
		episodeNumber: 9,
		episodeTitle: `Episódio final ${suffix}`,
		durationMs: 90_000,
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
	await callRpc(request, token, 'save_episode_choices', {
		p_episode_id: episodeId,
		p_option_1_label: 'ENTRAR',
		p_option_1_consequence: 'A personagem entra na sala.',
		p_option_2_label: 'FUGIR',
		p_option_2_consequence: 'A personagem foge da sala.',
	});

	await loginAsOwner(page);

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
	const exported = await page.request.get(`/api/export/${episodeId}?media=lite`);
	expect(exported.status()).toBe(200);
	expect(readZipTextEntry(Buffer.from(await exported.body()), 'finale/end-card.ass')).toContain(
		'ENTRAR',
	);

	await callRpc(request, token, 'save_episode_choices', {
		p_episode_id: episodeId,
		p_option_1_label: 'ENTRAR',
		p_option_1_consequence: 'A personagem entra e tranca a porta.\nNinguém sai.',
		p_option_2_label: 'FUGIR',
		p_option_2_consequence: 'A personagem foge da sala.',
	});
	await page.goto(`/app/finale?episodeId=${episodeId}`);
	await expect(page.locator('.stale')).toHaveCount(3);
	const blocked = await page.request.get(`/api/end-cards/${revisionId}?format=ass`);
	expect(blocked.status()).toBe(409);

	await callRpc(request, token, 'save_episode_choices', {
		p_episode_id: episodeId,
		p_option_1_label: 'ENTRAR AGORA',
		p_option_1_consequence: 'A personagem entra e tranca a porta.\nNinguém sai.',
		p_option_2_label: 'FUGIR',
		p_option_2_consequence: 'A personagem foge da sala.',
	});
	await page.goto(`/app/finale?episodeId=${episodeId}`);
	await expect(page.locator('.stale')).toHaveCount(3);

	await captureResponsivePages(page, {
		url: `/app/finale?episodeId=${episodeId}`,
		heading: 'Final A/B do episódio',
		prefix: 'finale',
	});
});
