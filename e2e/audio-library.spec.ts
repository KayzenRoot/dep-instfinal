import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('owner imports five licensed audio categories and filters the library', async ({ page }) => {
	test.setTimeout(600_000);
	test.skip(!process.env.E2E_OWNER_EMAIL, 'requires a synthetic owner in local Supabase');
	const workspace = await mkdtemp(path.join(tmpdir(), 'dif-audio-e2e-'));
	const definitions = [
		{ tag: 'porta', kind: 'SFX', title: 'Porta E2E', frequency: 220 },
		{ tag: 'passos', kind: 'SFX', title: 'Passos E2E', frequency: 300 },
		{ tag: 'impacto', kind: 'SFX', title: 'Impacto E2E', frequency: 520 },
		{ tag: 'drone', kind: 'AMBIENCE', title: 'Drone E2E', frequency: 90 },
		{ tag: 'ambiente', kind: 'MUSIC', title: 'Ambiente E2E', frequency: 160 },
	] as const;
	const categories = definitions.map((definition) => ({
		...definition,
		file: path.join(workspace, `${definition.tag}.wav`),
	}));
	try {
		for (const category of categories) {
			const file = category.file;
			execFileSync(
				'ffmpeg',
				[
					'-y',
					'-hide_banner',
					'-loglevel',
					'error',
					'-f',
					'lavfi',
					'-i',
					`sine=frequency=${category.frequency}:sample_rate=48000:duration=1`,
					'-ac',
					'1',
					'-c:a',
					'pcm_s16le',
					file,
				],
				{ timeout: 60_000, windowsHide: true },
			);
		}

		await page.goto('/login');
		await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
		await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
		await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
		await expect(page).toHaveURL(/\/app$/);
		await page.goto('/app/audio');
		await expect(page.getByRole('heading', { name: 'Biblioteca licenciada' })).toBeVisible();

		for (const category of categories) {
			await page.locator('input[type="file"]').setInputFiles(category.file);
			await page.getByLabel('Tipo').selectOption(category.kind);
			await page.getByLabel('Título', { exact: true }).fill(category.title);
			await page.getByLabel('Autor', { exact: true }).fill('DIF Studio');
			await page.getByLabel('Origem', { exact: true }).fill('Fixture sintética E2E');
			await page.getByLabel('Licença', { exact: true }).fill('CC0 1.0');
			await page
				.getByLabel('URL da licença')
				.fill('https://creativecommons.org/publicdomain/zero/1.0/');
			await page.getByLabel('Atribuição').fill('DIF Studio, CC0');
			await page.getByLabel('Status').selectOption('VERIFIED');
			await page.getByLabel('Tags separadas por vírgula').fill(category.tag);
			await page.getByLabel('Permite uso comercial').check();
			await page.getByLabel('Permite distribuição social').check();
			await page.getByRole('button', { name: 'Importar com licença' }).click();
			await expect(page.locator('.notice.success')).toContainText(category.title);
			await expect(page.getByRole('heading', { name: category.title })).toBeVisible();
		}

		await page.getByRole('link', { name: 'porta', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Porta E2E' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Passos E2E' })).toHaveCount(0);
		await page.getByRole('link', { name: 'Todos' }).click();
		for (const category of categories) {
			await expect(page.getByRole('heading', { name: category.title })).toBeVisible();
			const card = page.locator('.asset-list li').filter({ hasText: category.title });
			await expect(card.locator('audio')).toHaveAttribute('src', /\/api\/audio\/[0-9a-f-]+$/);
		}
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});
