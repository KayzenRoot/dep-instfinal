import { expect, test } from '@playwright/test';
import { readZipTextEntry } from './zip.js';

import { insertRow, ownerAccessToken, ownerId, serviceKey, supabaseUrl } from './supabase.js';

test('owner builds an identity kit and reviews visual continuity', async ({ page, request }) => {
	test.setTimeout(600_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	test.skip(!supabaseUrl || !serviceKey || !ownerId, 'requires local service role and owner id');
	page.setDefaultTimeout(60_000);
	page.setDefaultNavigationTimeout(120_000);

	const suffix = crypto.randomUUID().slice(0, 8);
	const seriesId = crypto.randomUUID();
	const seasonId = crypto.randomUUID();
	const characterId = crypto.randomUUID();
	const episodeId = crypto.randomUUID();
	const sceneId = crypto.randomUUID();
	const seriesTitle = `Identity E2E ${suffix}`;
	const token = await ownerAccessToken(request);
	await insertRow(request, token, 'series', {
		id: seriesId,
		owner_id: ownerId,
		title: seriesTitle,
		premise: 'Fixture sintética de identidade e continuidade.',
	});
	await insertRow(request, token, 'seasons', {
		id: seasonId,
		owner_id: ownerId,
		series_id: seriesId,
		season_number: 1,
		title: 'Temporada identidade',
		planned_episode_count: 10,
	});
	await insertRow(request, token, 'characters', {
		id: characterId,
		owner_id: ownerId,
		series_id: seriesId,
		name: 'Lara',
		role: 'PROTAGONIST',
		description: 'Personagem fictícia de teste.',
	});
	await insertRow(request, token, 'episodes', {
		id: episodeId,
		owner_id: ownerId,
		season_id: seasonId,
		episode_number: 1,
		title: `Episódio identidade ${suffix}`,
		duration_ms: 120_000,
	});
	await insertRow(request, token, 'scenes', {
		id: sceneId,
		owner_id: ownerId,
		episode_id: episodeId,
		scene_index: 1,
		start_ms: 0,
		end_ms: 8_000,
		character_notes: 'Lara entra no arquivo. FIGURINO: sobretudo verde-oliva',
		location: 'Arquivo',
		start_frame_prompt_en: 'wide shot of Lara entering a dark archive',
		end_frame_prompt_en: 'close-up of Lara holding a tape',
		motion_prompt_en: 'slow push-in',
	});

	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);

	await page.goto(`/app/identity?seriesId=${seriesId}&characterId=${characterId}`);
	await expect(page.getByRole('heading', { name: 'Identidade de personagem' })).toBeVisible();
	await page.locator('textarea[name="aliases"]').fill('Lara\nA Arquivista');
	await page.locator('input[name="hair"]').fill('cabelo preto na altura dos ombros');
	await page.locator('input[name="wardrobe"]').fill('sobretudo verde-oliva');
	await page.locator('input[name="silhouette"]').fill('alta e angular');
	await page.locator('textarea[name="negativePrompts"]').fill('logos modernos');
	await page
		.locator('textarea[name="looks"]')
		.fill(
			'Arquivo | 1 | 3 | sobretudo verde-oliva | cabelo preto na altura dos ombros | primeira fase',
		);
	await page.getByRole('button', { name: 'Salvar DRAFT' }).click();
	await expect(page.locator('.notice.success')).toContainText('Perfil salvo na versão 1');
	await page.getByRole('button', { name: 'Salvar e aprovar' }).click();
	await expect(page.locator('.notice.success')).toContainText('Perfil aprovado na versão 2');
	await expect(page.locator('.anchor')).toContainText('sobretudo verde-oliva');
	await page.getByRole('button', { name: 'Restaurar como DRAFT' }).first().click();
	await expect(page.locator('.notice.success')).toContainText(
		'Versão restaurada como DRAFT na versão 3',
	);

	const identityExport = await page.request.get(
		`/api/identity/${characterId}/export?format=json&episodeId=${episodeId}`,
	);
	expect(identityExport.status()).toBe(200);
	const identityPayload = (await identityExport.json()) as {
		characters: Array<{ anchor: string; checklist: string[] }>;
	};
	expect(identityPayload.characters[0]?.anchor).toContain('sobretudo verde-oliva');
	expect(identityPayload.characters[0]?.checklist.join(' ')).toContain('Wardrobe look');

	await page.goto(`/app/continuity/visual?episodeId=${episodeId}`);
	await expect(page.getByRole('heading', { name: 'Continuidade visual' })).toBeVisible();
	await page.getByRole('button', { name: 'Gerar relatório' }).click();
	await expect(page.locator('.notice.success')).toContainText('Relatório gerado');
	await expect(page.locator('.observation').first()).toBeVisible();
	await expect(page.locator('.observation').first()).toContainText('Frame');

	await page
		.locator('.observation')
		.first()
		.locator('select[name="status"]')
		.selectOption('BLOCKING');
	await page
		.locator('.observation')
		.first()
		.locator('textarea[name="rationale"]')
		.fill('Frame ausente; regenerar no Flow.');
	await page
		.locator('.observation')
		.first()
		.getByRole('button', { name: 'Registrar decisão' })
		.click();
	await expect(page.locator('.notice.success')).toContainText('Decisão registrada');
	const blockedExport = await page.request.get(`/api/export/${episodeId}?media=lite`);
	expect(blockedExport.status()).toBe(409);
	await page
		.locator('.observation')
		.first()
		.locator('select[name="status"]')
		.selectOption('RESOLVED');
	await page
		.locator('.observation')
		.first()
		.locator('textarea[name="rationale"]')
		.fill('Frame conferido manualmente no Flow.');
	await page
		.locator('.observation')
		.first()
		.getByRole('button', { name: 'Registrar decisão' })
		.click();
	await expect(page.locator('.notice.success')).toContainText('Decisão registrada');
	const releasedExport = await page.request.get(`/api/export/${episodeId}?media=lite`);
	expect(releasedExport.status()).toBe(200);
	expect(releasedExport.headers()['content-type']).toContain('application/zip');
	const archive = Buffer.from(await releasedExport.body());
	const manifest = JSON.parse(readZipTextEntry(archive, 'manifest.json')) as {
		identity: { profiles: Array<{ name: string }> };
		continuityVisual: { status: string; revision: number };
	};
	expect(manifest.identity.profiles[0]?.name).toBe('Lara');
	expect(manifest.continuityVisual).toMatchObject({ status: 'ACCEPTED', revision: 3 });
	const anchors = JSON.parse(readZipTextEntry(archive, 'identity/character-anchors.json')) as {
		characters: Array<{ anchor: string }>;
	};
	expect(anchors.characters[0]?.anchor).toContain('sobretudo verde-oliva');
	expect(readZipTextEntry(archive, 'identity/continuity-checklist.md')).toContain('Wardrobe look');
	expect(readZipTextEntry(archive, 'continuity/report.json')).toContain('"status": "ACCEPTED"');

	const reportExport = await page.request.get(`/api/continuity/${episodeId}/report?format=md`);
	expect(reportExport.status()).toBe(200);
	expect(await reportExport.text()).toContain('Visual continuity report');
});
