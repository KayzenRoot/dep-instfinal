import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loginAsOwner } from './fixtures';

const screenshotDirectory = path.join(process.cwd(), 'test-results', 'screenshots');

async function auditNavigationAria(page: Page): Promise<void> {
	const audit = await page.evaluate(() => {
		const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map(
			(element) => element.id,
		);
		const duplicateIds = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
		const brokenLabels: string[] = [];
		const outsideNav: string[] = [];
		for (const nav of Array.from(document.querySelectorAll('nav'))) {
			for (const labelled of Array.from(nav.querySelectorAll<HTMLElement>('[aria-labelledby]'))) {
				const ids = (labelled.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
				for (const id of ids) {
					const target = document.getElementById(id);
					if (!target) brokenLabels.push(id);
					else if (!nav.contains(target)) outsideNav.push(id);
				}
			}
		}
		return {
			duplicateIds,
			brokenLabels,
			outsideNav,
			nestedNavs: document.querySelectorAll('nav nav').length,
		};
	});
	expect(audit.duplicateIds, 'all DOM ids must be unique').toEqual([]);
	expect(audit.brokenLabels, 'aria-labelledby targets must exist').toEqual([]);
	expect(audit.outsideNav, 'labels must live inside their own nav').toEqual([]);
	expect(audit.nestedNavs, 'nav landmarks must not be nested').toBe(0);
}

test.describe('Neon Glass shell and navigation', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsOwner(page);
	});

	test('mobile drawer keeps every route and closes without stealing focus on navigation', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const toggle = page.locator('button[aria-controls="mobile-menu"]');
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
			'Sistema',
		]) {
			await expect(drawer.getByText(label, { exact: true })).toBeVisible();
		}
		await auditNavigationAria(page);

		await mkdir(screenshotDirectory, { recursive: true });
		await page.screenshot({
			path: path.join(screenshotDirectory, 'shell-mobile-menu-390.png'),
			fullPage: false,
		});

		await drawer.getByRole('link', { name: 'Identidade', exact: true }).click();
		await expect(page).toHaveURL(/\/app\/identity$/);
		await expect(drawer).toBeHidden();
		await expect(toggle).not.toBeFocused();
	});

	test('mobile dock and drawer work at the 320px minimum viewport', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		await expect(page.locator('button[aria-controls="mobile-menu"]')).toBeVisible();
		await expect(page.getByText('Sessão privada', { exact: true })).toBeVisible();
		const sectionLabel = page.locator('.console-label strong');
		await expect(sectionLabel).toHaveText('Visão geral');
		expect(
			await sectionLabel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
			'section label must remain fully readable at 320px',
		).toBe(true);

		const dock = page.getByTestId('quick-nav');
		await expect(dock).toBeVisible();
		await expect(dock.getByRole('link')).toHaveCount(5);
		for (const label of ['Painel', 'Séries', 'Episódios', 'Timeline', 'Exportar']) {
			await expect(dock.getByRole('link', { name: label, exact: true })).toBeVisible();
		}

		const toggle = page.locator('button[aria-controls="mobile-menu"]');
		await toggle.click();
		const drawer = page.locator('#mobile-menu');
		await expect(drawer).toBeVisible();
		await expect(drawer.getByRole('link')).toHaveCount(22);
		await expect(drawer.getByText('Cânone e análise', { exact: true })).toBeVisible();
		for (const label of ['Biblioteca visual', 'Configurações']) {
			const text = drawer.getByRole('link', { name: label, exact: true }).locator('.nav-label');
			expect(
				await text.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
				`${label} must wrap instead of clipping at 320px`,
			).toBe(true);
		}
		await auditNavigationAria(page);

		const measure = await page.evaluate(() => ({
			fits: document.documentElement.scrollWidth <= window.innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		expect(
			measure.fits,
			`shell should not overflow at 320px (scroll ${measure.scrollWidth} > ${measure.innerWidth})`,
		).toBe(true);

		await mkdir(screenshotDirectory, { recursive: true });
		await page.screenshot({
			path: path.join(screenshotDirectory, 'shell-mobile-menu-320.png'),
			fullPage: false,
		});
	});

	test('desktop navigation is grouped, unique and marks the active route', async ({ page }) => {
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
		await auditNavigationAria(page);
	});

	test('shell has no horizontal overflow at 320/390/768/1440/1920', async ({ page }) => {
		await mkdir(screenshotDirectory, { recursive: true });
		for (const width of [320, 390, 768, 1440, 1920]) {
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

	test('keyboard path keeps focus visible and restores it after Escape', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo' });
		const toggle = page.locator('button[aria-controls="mobile-menu"]');
		const drawer = page.locator('#mobile-menu');

		await page.keyboard.press('Tab');
		await expect(skipLink).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(toggle).toBeFocused();
		await expect
			.poll(() => toggle.evaluate((element) => getComputedStyle(element).boxShadow))
			.not.toBe('none');

		await page.keyboard.press('Enter');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(drawer).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(drawer.getByRole('link', { name: 'Painel', exact: true })).toBeFocused();

		await mkdir(screenshotDirectory, { recursive: true });
		await page.screenshot({
			path: path.join(screenshotDirectory, 'shell-focus-toggle-390.png'),
			fullPage: false,
		});

		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();
		await expect(toggle).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(skipLink).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('#workspace-main')).toBeFocused();
	});

	test('reduced motion disables navigation lift and long transitions', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const series = page
			.getByTestId('desktop-nav')
			.getByRole('link', { name: 'Séries', exact: true });
		await series.hover();
		const styles = await series.evaluate((element) => {
			const computed = getComputedStyle(element);
			return {
				transform: computed.transform,
				transitionDuration: computed.transitionDuration,
				reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
			};
		});
		expect(styles.reduced).toBe(true);
		expect(styles.transform).toBe('none');
		const durations = styles.transitionDuration.split(',').map((value) => parseFloat(value));
		expect(Math.max(...durations)).toBeLessThanOrEqual(0.02);
	});
});
