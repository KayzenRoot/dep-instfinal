import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('health exposes setup booleans only and is never cached', async ({ request }) => {
	const response = await request.get('/health');
	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toContain('no-store');
	expect(await response.json()).toEqual({
		status: 'ok',
		configured: {
			supabase: Boolean(process.env.PUBLIC_SUPABASE_URL),
			owner: Boolean(process.env.SUPABASE_OWNER_USER_ID),
		},
	});
});

test('anonymous visitor can only reach the login surface', async ({ page }) => {
	const response = await page.goto('/app');
	expect(response?.status()).toBe(200);
	expect(new URL(page.url()).pathname).toBe('/login');
	await expect(page.getByRole('heading', { name: /DIF Studio/i })).toBeVisible();
	if (process.env.SUPABASE_OWNER_USER_ID) {
		await expect(page.getByLabel('E-mail do proprietário')).toBeEnabled();
	} else {
		await expect(page.getByLabel('E-mail do proprietário')).toBeDisabled();
	}
	await expect(page.getByRole('link', { name: /cadastro|criar conta|sign up/i })).toHaveCount(0);
	const login = await page
		.locator('main')
		.evaluate((node) => node.scrollWidth <= window.innerWidth);
	expect(login).toBe(true);
});

test('login layout fits 360, 768, and 1440 pixel viewports', async ({ page }) => {
	const screenshotDirectory = path.join(process.cwd(), 'test-results', 'screenshots');
	await mkdir(screenshotDirectory, { recursive: true });
	for (const width of [360, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/login');
		await expect(page.getByLabel('E-mail do proprietário')).toBeVisible();
		const fits = await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		);
		expect(fits, `page should not overflow at ${width}px`).toBe(true);
		await page.screenshot({
			path: path.join(screenshotDirectory, `login-${width}.png`),
			fullPage: true,
		});
	}
});

test('private media endpoint rejects anonymous visitors', async ({ request }) => {
	const response = await request.get('/api/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
		maxRedirects: 0,
	});
	if (process.env.PUBLIC_SUPABASE_URL && process.env.SUPABASE_OWNER_USER_ID) {
		expect(response.status()).toBe(401);
	} else {
		expect(response.status()).toBe(303);
		expect(response.headers().location).toBe('/login?setup=required');
	}
});

test('cross-origin mutations are rejected before reaching their handlers', async ({ request }) => {
	const response = await request.post('/auth/logout', {
		headers: { origin: 'https://untrusted.invalid' },
	});
	expect(response.status()).toBe(403);
});

test('owner completes series, episode, voting, canon, continuation, and export journey', async ({
	page,
}) => {
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await page.getByLabel('Título', { exact: true }).fill('Arquivo E2E persistido');
	await page.getByLabel('Premissa').fill('Registro de aceitação com Supabase local.');
	await page.getByRole('button', { name: /Abrir novo arquivo/ }).click();
	await expect(page).toHaveURL(/\/app\/series\/[0-9a-f-]+$/);
	await expect(page.getByRole('heading', { name: 'Arquivo E2E persistido' })).toBeVisible();
	const seriesUrl = page.url();
	await page.getByLabel('Número', { exact: true }).fill('1');
	await page.getByLabel('Episódios planejados').fill('12');
	await page.getByLabel('Título', { exact: true }).nth(1).fill('Temporada um');
	await page.getByRole('button', { name: 'Adicionar temporada' }).click();
	await expect(page.getByText('Temporada um')).toBeVisible();
	await page.getByLabel('Nome').fill('Lara E2E');
	await page.getByLabel('Papel na história').fill('Arquivista');
	await page.getByRole('button', { name: 'Salvar personagem' }).click();
	await expect(page.getByText('Lara E2E')).toBeVisible();
	await page.getByLabel('Categoria').selectOption('RULE');
	await page.getByLabel('Título', { exact: true }).last().fill('Regra do arquivo');
	await page.getByLabel('Fato').fill('Uma fita não pode gravar o futuro.');
	await page.getByRole('button', { name: 'Registrar fato' }).click();
	await expect(page.getByText('Regra do arquivo')).toBeVisible();
	await page.getByPlaceholder('Título do episódio').fill('A fita de amanhã');
	await page.getByLabel('Duração').fill('120');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const firstEpisodeUrl = page.url();
	const firstEpisodeId = firstEpisodeUrl.split('/').at(-1)!;
	await expect(page.getByText('120 s · 15 cenas')).toBeVisible();
	await page.getByLabel('Título', { exact: true }).fill('A fita de amanhã');
	await page.getByLabel('Narrativa').fill('Lara encontra uma fita gravada com sua própria voz.');
	await page
		.getByLabel('Narração completa · português brasileiro')
		.fill('A fita começa a tocar antes de ser ligada.');
	await page.getByRole('button', { name: 'Salvar roteiro e revisar timeline' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'Alterações salvas. Uma nova revisão foi registrada.',
	);
	await page.waitForLoadState('networkidle');
	const choiceForm = page.locator('form.choice-grid');
	await choiceForm.locator('[name="option1Label"]').fill('Ouvir a fita');
	await choiceForm
		.locator('[name="option1Consequence"]')
		.fill('Lara ouve o aviso sobre o arquivo.');
	await choiceForm.locator('[name="option2Label"]').fill('Destruir a fita');
	await choiceForm
		.locator('[name="option2Consequence"]')
		.fill('Lara apaga a única prova do aviso.');
	await expect(choiceForm.locator('[name="option1Label"]')).toHaveValue('Ouvir a fita');
	await expect(choiceForm.locator('[name="option1Consequence"]')).toHaveValue(
		'Lara ouve o aviso sobre o arquivo.',
	);
	const invalidChoiceFields = await choiceForm.evaluate((form) =>
		Array.from(form.querySelectorAll('input, textarea'))
			.filter((field) => !field.checkValidity())
			.map((field) => ({ name: field.getAttribute('name'), message: field.validationMessage })),
	);
	expect(invalidChoiceFields).toEqual([]);
	await page.getByRole('button', { name: 'Salvar as duas opções' }).click();
	await expect(page.getByText('2 de 2', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Validar e marcar pronto' }).click();
	await expect(page.getByText('READY', { exact: true })).toBeVisible();
	await page.getByLabel(/Revisei texto, continuidade e cenas\./).check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
	await page.getByLabel('Referência do post').fill('manual-e2e');
	await page.getByLabel('Horas até encerrar').fill('1');
	await page
		.getByLabel('Regra publicada para desempate')
		.fill('A opção 1 vence em caso de empate.');
	await page.getByRole('button', { name: 'Abrir registro da votação' }).click();
	await page.getByRole('button', { name: 'Registrar encerramento manual' }).click();
	await page.getByLabel('Votos · opção 1').fill('14');
	await page.getByLabel('Votos · opção 2').fill('9');
	await page.getByLabel('Fonte consultada').fill('Contagem sintética da aceitação E2E');
	await page.getByLabel(/Conferi estes totais/).check();
	await page.getByRole('button', { name: 'Salvar resultado verificado' }).click();
	await expect(page.getByText('Vence opção 1')).toBeVisible();
	await page.locator('[name="canonSnapshot"]').fill('{"ramo":"Lara ouviu o aviso"}');
	await page.getByLabel('Justificativa da autora').fill('Aprovado para esta aceitação sintética.');
	await page.getByLabel(/Revisei e aprovo este estado como novo cânone/).check();
	await page.getByRole('button', { name: 'Registrar decisão append-only' }).click();
	await expect(page.getByText('DECISÃO R01')).toBeVisible();
	await page.goto(seriesUrl);
	await page.getByPlaceholder('Título do episódio').fill('O aviso continua');
	await page.locator('[name="episodeNumber"]').fill('2');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const continuationId = page.url().split('/').at(-1)!;
	expect(continuationId).not.toBe(firstEpisodeId);
	const exportResponse = await page.request.get(`/api/export/${continuationId}`);
	expect(exportResponse.status()).toBe(200);
	expect(exportResponse.headers()['content-type']).toContain('application/zip');
	const archive = Buffer.from(await exportResponse.body());
	expect(archive.subarray(0, 2).toString()).toBe('PK');
	await page.goto('/app');
	await page.getByRole('button', { name: 'Encerrar sessão' }).click();
	await expect(page).toHaveURL(/\/login\?logged-out=1$/);
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await expect(page.getByRole('link', { name: /Arquivo E2E persistido/ })).toBeVisible();
});

test('a valid non-owner Supabase identity is rejected', async ({ page }) => {
	test.skip(!process.env.E2E_OTHER_EMAIL, 'requires a synthetic non-owner in local Supabase');
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OTHER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OTHER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('alert')).toContainText('Não foi possível autenticar esta conta.');
});

test('owner credentials with an invalid password are rejected', async ({ page }) => {
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill('not-the-test-password');
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('alert')).toContainText('Não foi possível autenticar esta conta.');
});
