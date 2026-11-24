import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginAsOwner } from './fixtures';

const screenshotDirectory = path.join(process.cwd(), 'test-results', 'screenshots');

test.describe('Neon Glass shell and navigation', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsOwner(page);
	});

	test('mobile drawer keeps every application route reachable', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const toggle = page.getByRole('button', { name: 'Abrir navegação' });
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const drawer = page.locator('#mobile-menu');
		await expect(drawer).toBeVisible();
		await expect(drawer.getByRole('link')).toHaveCount(22);
		for (const label of [
			'Visão geral',
			'Produção',
			'Visual',
			'Áudio e texto',
			'Cânone e análise',
		]) {
			await expect(drawer.getByText(label, { exact: true })).toBeVisible();
		}

		await mkdir(screenshotDirectory, { recursive: true });
		await page.screenshot({
			path: path.join(screenshotDirectory, 'shell-mobile-menu-390.png'),
			fullPage: false,
		});

		await drawer.getByRole('link', { name: 'Identidade', exact: true }).click();
		await expect(page).toHaveURL(/\/app\/identity$/);
		await expect(drawer).toBeHidden();
	});

	test('mobile dock exposes the five quick destinations', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');

		const dock = page.getByTestId('quick-nav');
		await expect(dock).toBeVisible();
		await expect(dock.getByRole('link')).toHaveCount(5);
		for (const label of ['Painel', 'Séries', 'Episódios', 'Timeline', 'Exportar']) {
			await expect(dock.getByRole('link', { name: label, exact: true })).toBeVisible();
		}
	});

	test('desktop navigation is grouped and marks the active route', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/app/style');

		const nav = page
			.getByTestId('desktop-nav')
			.getByRole('navigation', { name: 'Navegação principal' });
		await expect(nav).toBeVisible();
		await expect(nav.getByRole('link')).toHaveCount(22);
		await expect(nav.getByText('Cânone e análise', { exact: true })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Estilo', exact: true })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(nav.getByRole('link', { name: 'Painel', exact: true })).not.toHaveAttribute(
			'aria-current',
			'page',
		);
	});

	test('shell has no horizontal overflow at 390/768/1440/1920', async ({ page }) => {
		await mkdir(screenshotDirectory, { recursive: true });
		for (const width of [390, 768, 1440, 1920]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.goto('/app');
			await expect(page.getByRole('heading', { name: 'O sinal continua.' })).toBeVisible();

			const measure = await page.evaluate(() => ({
				fits: document.documentElement.scrollWidth <= window.innerWidth,
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
			}));
			expect(
				measure.fits,
				`shell should not overflow at ${width}px (scroll ${measure.scrollWidth} > ${measure.innerWidth})`,
			).toBe(true);

			await page.screenshot({
				path: path.join(screenshotDirectory, `shell-${width}.png`),
				fullPage: true,
			});
		}
	});

	test('Escape closes the mobile menu and the skip link reaches the workspace', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const toggle = page.getByRole('button', { name: 'Abrir navegação' });
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const drawer = page.locator('#mobile-menu');
		await expect(drawer).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();

		const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo' });
		await skipLink.focus();
		await expect(skipLink).toBeVisible();
		await skipLink.press('Enter');
		await expect(page).toHaveURL(/#workspace-main$/);
	});
});
