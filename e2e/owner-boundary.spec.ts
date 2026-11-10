import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

function contextFromNarrativePrompt(prompt: string) {
	const match = prompt.match(/## Contexto canônico \(JSON\)\s+```json\s+([\s\S]+?)\s+```/);
	if (!match) throw new Error('The exported narrative prompt did not contain its JSON context.');
	return JSON.parse(match[1]);
}

function readZipTextEntry(archive: Buffer, entryName: string): string {
	const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
	let centralOffset = archive.indexOf(signature);
	while (centralOffset >= 0) {
		const compressedSize = archive.readUInt32LE(centralOffset + 20);
		const method = archive.readUInt16LE(centralOffset + 10);
		const nameLength = archive.readUInt16LE(centralOffset + 28);
		const extraLength = archive.readUInt16LE(centralOffset + 30);
		const commentLength = archive.readUInt16LE(centralOffset + 32);
		const name = archive.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);
		if (name === entryName) {
			const localOffset = archive.readUInt32LE(centralOffset + 42);
			const localNameLength = archive.readUInt16LE(localOffset + 26);
			const localExtraLength = archive.readUInt16LE(localOffset + 28);
			const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
			const compressed = archive.subarray(contentOffset, contentOffset + compressedSize);
			if (method === 0) return compressed.toString('utf8');
			if (method === 8) return inflateRawSync(compressed).toString('utf8');
			throw new Error(`Unsupported ZIP compression method ${method}.`);
		}
		centralOffset += 46 + nameLength + extraLength + commentLength;
		if (centralOffset > archive.length - 46) break;
		centralOffset = archive.indexOf(signature, centralOffset);
	}
	throw new Error(`ZIP entry ${entryName} was not found.`);
}

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
	test.setTimeout(90_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	const seriesTitle = `Arquivo E2E persistido ${crypto.randomUUID().slice(0, 8)}`;
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await page.getByLabel('Título', { exact: true }).fill(seriesTitle);
	await page.getByLabel('Premissa').fill('Registro de aceitação com Supabase local.');
	await page.getByRole('button', { name: /Abrir novo arquivo/ }).click();
	await expect(page).toHaveURL(/\/app\/series\/[0-9a-f-]+$/);
	await expect(page.getByRole('heading', { name: seriesTitle })).toBeVisible();
	const seriesUrl = page.url();
	await page.getByLabel('Número', { exact: true }).fill('1');
	await page.getByLabel('Episódios planejados').fill('10');
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
	const initialPromptResponse = await page.request.get(`/api/narrative-prompt/${firstEpisodeId}`);
	expect(initialPromptResponse.status()).toBe(200);
	const initialPrompt = await initialPromptResponse.text();
	expect(initialPromptResponse.headers()['content-disposition']).toContain('attachment');
	expect(initialPrompt).toContain('Lara E2E');
	expect(initialPrompt).toContain('Uma fita não pode gravar o futuro.');
	expect(initialPrompt).toContain('DIF Studio · prompt manual');
	const narration = Array.from({ length: 290 }, (_, index) => `palavra${index + 1}`).join(' ');
	const manualResponse = {
		title: 'A fita de amanhã',
		logline: 'Lara encontra uma fita gravada com sua própria voz.',
		hook: 'A fita começa a tocar antes de ser ligada.',
		narrative: 'Lara encontra uma fita marcada com a data de amanhã.',
		narrationPtBr: narration,
		reveal: 'A voz gravada responde a perguntas que Lara ainda não fez.',
		cliffhanger: 'A câmera mostra alguém atrás dela.',
		durationSeconds: 120,
		speechSpeedWpm: 145,
		screenSuggestion: 'Close no carretel que gira sozinho.',
		soundSuggestion: 'Ruído de fita e uma voz em reverso.',
		coverText: 'A fita de amanhã',
		tiktok: {
			title: 'A fita de amanhã',
			cta: 'Escolha o próximo passo.',
			description: 'Lara ouviu a própria voz.',
		},
		instagram: {
			title: 'A voz de amanhã',
			cta: 'Vote na continuação.',
			description: 'O arquivo guarda uma fita impossível.',
		},
		choices: [
			{ label: 'Ouvir a fita', consequence: 'Lara ouve o aviso sobre o arquivo.' },
			{ label: 'Destruir a fita', consequence: 'Lara apaga a única prova do aviso.' },
		],
	};
	const importForm = page.locator('form.narrative-import-form');
	await importForm
		.locator('[name="responseJson"]')
		.fill(JSON.stringify({ ...manualResponse, choices: [] }));
	await importForm.locator('[name="confirmImport"]').check();
	await importForm.getByRole('button', { name: 'Validar e importar resposta' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Este episódio ainda terá continuação e exige duas opções de votação diferentes.',
	);
	await importForm.locator('[name="responseJson"]').fill(JSON.stringify(manualResponse));
	await importForm.locator('[name="confirmImport"]').check();
	await importForm.getByRole('button', { name: 'Validar e importar resposta' }).click();
	await expect(page.locator('p.form-success[role="status"]')).toContainText(
		'Estimativa de narração: 120 s',
	);
	await page.waitForLoadState('networkidle');
	const choiceForm = page.locator('form.choice-grid');
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
	const publishConfirmation = page.locator('form.publish-form input[name="publishConfirmed"]');
	await expect(publishConfirmation).toBeVisible();
	await publishConfirmation.check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
	await page.getByLabel('Referência do post').fill('manual-e2e');
	await page.getByLabel('Horas até encerrar').fill('1');
	await page
		.getByLabel('Regra publicada para desempate')
		.fill('A opção 1 vence em caso de empate.');
	await page.getByRole('button', { name: 'Abrir registro da votação' }).click();
	const pollId = await page.locator('form[action="?/closePoll"] [name="pollId"]').inputValue();
	const prematureCanonResponse = await page.evaluate(
		async ({ episodeId, pollId }) => {
			const response = await fetch(`/app/episodes/${episodeId}?/approveCanon`, {
				method: 'POST',
				headers: {
					accept: 'application/json',
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					acceptCanon: 'on',
					pollId,
					pollResultId: '11111111-1111-4111-8111-111111111111',
					canonSnapshot: '{"branch":"unverified"}',
					rationale: 'This must remain pending.',
				}),
			});
			return response.status;
		},
		{ episodeId: firstEpisodeId, pollId },
	);
	expect(prematureCanonResponse).toBe(409);
	await page.goto(seriesUrl);
	await page.getByPlaceholder('Título do episódio').fill('O aviso continua');
	await page.locator('[name="episodeNumber"]').fill('2');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const continuationId = page.url().split('/').at(-1)!;
	const pendingPromptResponse = await page.request.get(`/api/narrative-prompt/${continuationId}`);
	expect(pendingPromptResponse.status()).toBe(200);
	const pendingContext = contextFromNarrativePrompt(await pendingPromptResponse.text());
	expect(pendingContext.latestPreviousCanon.status).toBe('VOTE_OPEN');
	expect(pendingContext.latestPreviousCanon.approvedCanon).toBeNull();
	expect(pendingContext.priorEpisodes[0].narrative).toContain('Lara encontra uma fita');
	expect(pendingContext.loreFacts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				title: 'Regra do arquivo',
				fact: 'Uma fita não pode gravar o futuro.',
			}),
		]),
	);
	const continuationResponse = {
		...manualResponse,
		title: 'O aviso continua',
		logline: 'Lara encontra uma segunda faixa na fita.',
		choices: [
			{ label: 'Ouvir a fita', consequence: 'Lara ouve o aviso sobre o arquivo.' },
			{ label: 'Destruir a fita', consequence: 'Lara apaga a única prova do aviso.' },
		],
	};
	const continuationImport = page.locator('form.narrative-import-form');
	await continuationImport
		.locator('[name="responseJson"]')
		.fill(JSON.stringify(continuationResponse));
	await continuationImport.locator('[name="confirmImport"]').check();
	await continuationImport.getByRole('button', { name: 'Validar e importar resposta' }).click();
	await expect(page.locator('p.form-success[role="status"]')).toContainText(
		'Estimativa de narração: 120 s',
	);
	await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Validar e marcar pronto' }).click();
	await expect(page.getByText('READY', { exact: true })).toBeVisible();
	await page.locator('form.publish-form input[name="publishConfirmed"]').check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'encerre a votação aberta do episódio anterior',
	);
	expect(await page.getByText('READY', { exact: true }).count()).toBe(1);
	await page.goto(firstEpisodeUrl);
	await page.getByRole('button', { name: 'Registrar encerramento manual' }).click();
	await page.getByLabel('Votos · opção 1').fill('14');
	await page.getByLabel('Votos · opção 2').fill('9');
	await page.getByLabel('Fonte consultada').fill('Contagem sintética da aceitação E2E');
	await page.getByLabel(/Conferi estes totais/).check();
	await page.getByRole('button', { name: 'Salvar resultado verificado' }).click();
	await expect(page.getByText('Vence opção 1')).toBeVisible();
	await page.locator('[name="canonSnapshot"]').fill('{"ramo":"Lara ouviu o aviso"}');
	await page.getByLabel('Justificativa da autora').fill('Aprovado para esta aceitação sintética.');
	const canonConfirmation = page.locator('form[action="?/approveCanon"] input[name="acceptCanon"]');
	await expect(canonConfirmation).toBeVisible();
	await canonConfirmation.check();
	await page.getByRole('button', { name: 'Registrar decisão append-only' }).click();
	await expect(page.getByText('DECISÃO R01')).toBeVisible();
	expect(continuationId).not.toBe(firstEpisodeId);
	await page.getByLabel('Votos · opção 1').fill('5');
	await page.getByLabel('Votos · opção 2').fill('14');
	await page.getByLabel('Fonte consultada').fill('Retificação sintética da aceitação E2E');
	await page.getByLabel(/Conferi estes totais/).check();
	await page.getByRole('button', { name: 'Salvar resultado verificado' }).click();
	await expect(page.getByText('Vence opção 2')).toBeVisible();
	await page.goto(`/app/episodes/${continuationId}`);
	await page.locator('form.publish-form input[name="publishConfirmed"]').check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByRole('alert')).toContainText('decisão aprovada está desatualizada');
	await page.goto(firstEpisodeUrl);
	await page
		.locator('[name="canonSnapshot"]')
		.fill('{"ramo":"Lara destruiu a fita após retificação"}');
	await page
		.getByLabel('Justificativa da autora')
		.fill('A retificação aprovada substitui a decisão anterior.');
	const correctedCanonConfirmation = page.locator(
		'form[action="?/approveCanon"] input[name="acceptCanon"]',
	);
	await correctedCanonConfirmation.check();
	await page.getByRole('button', { name: 'Registrar decisão append-only' }).click();
	await expect(page.getByText('DECISÃO R02')).toBeVisible();
	await page.goto(`/app/episodes/${continuationId}`);
	await page.locator('form.publish-form input[name="publishConfirmed"]').check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
	const branchOnePrompt = await page.request.get(
		`/api/narrative-prompt/${continuationId}?branch=1&wpm=145`,
	);
	const branchTwoPrompt = await page.request.get(
		`/api/narrative-prompt/${continuationId}?branch=2&wpm=145`,
	);
	expect(branchOnePrompt.status()).toBe(200);
	expect(branchTwoPrompt.status()).toBe(200);
	const branchOneContext = contextFromNarrativePrompt(await branchOnePrompt.text());
	const branchTwoContext = contextFromNarrativePrompt(await branchTwoPrompt.text());
	expect(branchOneContext.latestPreviousCanon.status).toBe('APPROVED');
	expect(branchOneContext.latestPreviousCanon.approvedCanon.selectedOption).toBe('2');
	expect(branchOneContext.latestPreviousCanon.approvedCanon.selectedChoice.label).toBe(
		'Destruir a fita',
	);
	expect(branchOneContext.hypotheticalBranch).toMatchObject({
		status: 'HYPOTHETICAL_NOT_CANON',
		isCanon: false,
		selectedOption: '1',
		consequence: 'Lara ouve o aviso sobre o arquivo.',
	});
	expect(branchTwoContext.hypotheticalBranch).toMatchObject({
		status: 'HYPOTHETICAL_NOT_CANON',
		isCanon: false,
		selectedOption: '2',
		consequence: 'Lara apaga a única prova do aviso.',
	});
	expect(JSON.stringify(branchOneContext)).not.toBe(JSON.stringify(branchTwoContext));
	expect(branchTwoContext.characters).toEqual(
		expect.arrayContaining([expect.objectContaining({ name: 'Lara E2E' })]),
	);
	expect(branchTwoContext.loreFacts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				title: 'Regra do arquivo',
				fact: 'Uma fita não pode gravar o futuro.',
			}),
		]),
	);
	const exportResponse = await page.request.get(`/api/export/${continuationId}`);
	expect(exportResponse.status()).toBe(200);
	expect(exportResponse.headers()['content-type']).toContain('application/zip');
	const archive = Buffer.from(await exportResponse.body());
	expect(archive.subarray(0, 2).toString()).toBe('PK');
	const exportedContext = JSON.parse(readZipTextEntry(archive, 'narrative/context.json'));
	expect(exportedContext.latestPreviousCanon.status).toBe('APPROVED');
	expect(exportedContext.latestPreviousCanon.approvedCanon.selectedChoice.consequence).toBe(
		'Lara apaga a única prova do aviso.',
	);
	expect(exportedContext.loreFacts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				title: 'Regra do arquivo',
				fact: 'Uma fita não pode gravar o futuro.',
			}),
		]),
	);
	expect(readZipTextEntry(archive, 'narrative/continuation-prompt.md')).toContain(
		'HYPOTHETICAL_NOT_CANON',
	);
	const episodeExport = await page.request.get(`/api/export/${firstEpisodeId}`);
	expect(episodeExport.status()).toBe(200);
	const episodeArchive = Buffer.from(await episodeExport.body());
	expect(JSON.parse(readZipTextEntry(episodeArchive, 'social/platform-copy.json'))).toMatchObject({
		speechSpeedWpm: 145,
		screenSuggestion: 'Close no carretel que gira sozinho.',
		soundSuggestion: 'Ruído de fita e uma voz em reverso.',
		tiktok: { title: 'A fita de amanhã', cta: 'Escolha o próximo passo.' },
		instagram: { title: 'A voz de amanhã', cta: 'Vote na continuação.' },
	});
	await page.goto(`/app/episodes/${continuationId}`);
	await page.getByLabel('Referência do post').fill('manual-e2e-continuation');
	await page.getByLabel('Horas até encerrar').fill('1');
	await page
		.getByLabel('Regra publicada para desempate')
		.fill('A opção 1 vence em caso de empate.');
	await page.getByRole('button', { name: 'Abrir registro da votação' }).click();
	await page.getByRole('button', { name: 'Registrar encerramento manual' }).click();
	await page.getByLabel('Votos · opção 1').fill('12');
	await page.getByLabel('Votos · opção 2').fill('7');
	await page.getByLabel('Fonte consultada').fill('Contagem sintética para o episódio seguinte');
	await page.getByLabel(/Conferi estes totais/).check();
	await page.getByRole('button', { name: 'Salvar resultado verificado' }).click();
	await expect(page.getByText('Vence opção 1')).toBeVisible();
	await page.locator('[name="canonSnapshot"]').fill('{"ramo":"Lara seguiu o aviso"}');
	await page
		.getByLabel('Justificativa da autora')
		.fill('Cânone aprovado para a continuação seguinte.');
	await page.locator('form[action="?/approveCanon"] input[name="acceptCanon"]').check();
	await page.getByRole('button', { name: 'Registrar decisão append-only' }).click();
	await expect(page.getByText('DECISÃO R01')).toBeVisible();
	await page.goto(seriesUrl);
	await page.getByPlaceholder('Título do episódio').fill('A antecâmara do fim');
	await page.locator('[name="episodeNumber"]').fill('3');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const penultimateResponse = {
		...manualResponse,
		title: 'A antecâmara do fim',
		choices: [
			{ label: 'Abrir a sala', consequence: 'Lara encontra a origem do sinal.' },
			{ label: 'Selar a sala', consequence: 'Lara preserva o arquivo e perde o sinal.' },
		],
	};
	const penultimateImport = page.locator('form.narrative-import-form');
	await penultimateImport
		.locator('[name="responseJson"]')
		.fill(JSON.stringify(penultimateResponse));
	await penultimateImport.locator('[name="confirmImport"]').check();
	await penultimateImport.getByRole('button', { name: 'Validar e importar resposta' }).click();
	await expect(page.locator('p.form-success[role="status"]')).toContainText(
		'Estimativa de narração: 120 s',
	);
	await page.getByRole('button', { name: 'Validar e marcar pronto' }).click();
	await expect(page.getByText('READY', { exact: true })).toBeVisible();
	await page.locator('form.publish-form input[name="publishConfirmed"]').check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
	await page.getByLabel('Referência do post').fill('manual-e2e-penultimate');
	await page.getByLabel('Horas até encerrar').fill('1');
	await page
		.getByLabel('Regra publicada para desempate')
		.fill('A opção 1 vence em caso de empate.');
	await page.getByRole('button', { name: 'Abrir registro da votação' }).click();
	await page.getByRole('button', { name: 'Registrar encerramento manual' }).click();
	await page.getByLabel('Votos · opção 1').fill('12');
	await page.getByLabel('Votos · opção 2').fill('7');
	await page.getByLabel('Fonte consultada').fill('Contagem sintética anterior ao final E2E');
	await page.getByLabel(/Conferi estes totais/).check();
	await page.getByRole('button', { name: 'Salvar resultado verificado' }).click();
	await expect(page.getByText('Vence opção 1')).toBeVisible();
	await page.locator('[name="canonSnapshot"]').fill('{"ramo":"Lara abriu a sala"}');
	await page.getByLabel('Justificativa da autora').fill('Cânone aprovado para o teste final.');
	await page.locator('form[action="?/approveCanon"] input[name="acceptCanon"]').check();
	await page.getByRole('button', { name: 'Registrar decisão append-only' }).click();
	await expect(page.getByText('DECISÃO R01')).toBeVisible();
	await page.goto(seriesUrl);
	await page.getByPlaceholder('Título do episódio').fill('O último registro');
	const finaleNumber = page.locator('[name="episodeNumber"]');
	await finaleNumber.fill('10');
	await expect(finaleNumber).toHaveValue('10');
	await page.getByLabel('Duração').fill('120');
	await page.getByRole('button', { name: 'Criar rascunho' }).click();
	await expect(page).toHaveURL(/\/app\/episodes\/[0-9a-f-]+$/);
	const finaleId = page.url().split('/').at(-1)!;
	const finalePrompt = await page.request.get(`/api/narrative-prompt/${finaleId}`);
	expect(finalePrompt.status()).toBe(200);
	const finalePromptText = await finalePrompt.text();
	const finaleContext = finalePromptText.match(
		/## Contexto canônico \(JSON\)\r?\n\r?\n```json\r?\n([\s\S]*?)\r?\n```/,
	);
	expect(finaleContext).not.toBeNull();
	expect(JSON.parse(finaleContext![1])).toMatchObject({
		preparedFor: { episodeNumber: 10, isSeasonFinale: true },
	});
	expect(finalePromptText).toContain('"choices": []');
	const finaleResponse = { ...manualResponse, title: 'O último registro', choices: [] };
	const finaleImport = page.locator('form.narrative-import-form');
	await finaleImport.locator('[name="responseJson"]').fill(JSON.stringify(finaleResponse));
	await finaleImport.locator('[name="confirmImport"]').check();
	await finaleImport.getByRole('button', { name: 'Validar e importar resposta' }).click();
	await expect(page.locator('p.form-success[role="status"]')).toContainText(
		'Estimativa de narração: 120 s',
	);
	await expect(
		page.getByText('Este é o episódio final planejado e não precisa de opções nem votação.'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Validar e marcar pronto' }).click();
	await expect(page.getByText('READY', { exact: true })).toBeVisible();
	await page.locator('form.publish-form input[name="publishConfirmed"]').check();
	await page.getByRole('button', { name: 'Publicar e bloquear edição' }).click();
	await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
	const finalePollResponse = await page.request.post(`/app/episodes/${finaleId}?/createPoll`, {
		headers: {
			accept: 'application/json',
			origin: new URL(page.url()).origin,
		},
		form: {
			durationHours: '1',
			tieBreakOption: '1',
			tieBreakRule: 'A opção 1 venceria em empate.',
			externalPostId: '',
		},
	});
	expect(finalePollResponse.status()).toBe(409);
	await page.goto('/app');
	await page.getByRole('button', { name: 'Encerrar sessão' }).click();
	await expect(page).toHaveURL(/\/login\?logged-out=1$/);
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await expect(page.getByRole('link', { name: new RegExp(seriesTitle) })).toBeVisible();
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
