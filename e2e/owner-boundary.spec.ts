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

test('a valid owner can persist a series across a new session', async ({ page }) => {
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
