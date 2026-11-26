import { expect, test } from '@playwright/test';
import { loginAsOwner } from './fixtures';

test.describe('contextual help tooltips', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsOwner(page);
	});

	test('hover exposes real help without covering the page', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const trigger = page.getByRole('button', { name: 'Ajuda sobre Séries', exact: true });
		await trigger.hover();
		const tooltip = page.getByRole('tooltip');
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toContainText('Conta as séries visíveis');
		await expect(tooltip).toContainText('Não representa publicações');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(trigger).toHaveAttribute('aria-describedby', 'help-dashboard-series-tooltip');

		const box = await tooltip.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
		expect(box!.y + box!.height).toBeLessThanOrEqual(900);
	});

	test('keyboard opens, Escape closes and focus returns to the trigger', async ({ page }) => {
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const trigger = page.getByRole('button', { name: 'Ajuda sobre Votações abertas', exact: true });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('tooltip')).toBeVisible();
		await expect(page.getByRole('tooltip')).toContainText('resultado nunca é aplicado');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');

		await page.keyboard.press('Escape');
		await expect(page.getByRole('tooltip')).toBeHidden();
		await expect(trigger).toBeFocused();
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});

	test('click/touch pins the tooltip and outside click dismisses it', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const trigger = page.getByRole('button', { name: 'Ajuda sobre Quadros e mídias', exact: true });
		await trigger.click();
		await expect(page.getByRole('tooltip')).toBeVisible();
		await expect(page.getByRole('tooltip')).toContainText('Cloudinary privado');
		await page.getByRole('heading', { name: 'O sinal continua.' }).click();
		await expect(page.getByRole('tooltip')).toBeHidden();
	});

	test('form help works at 320px and stays inside the viewport', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const trigger = page.getByRole('button', { name: 'Ajuda sobre Premissa', exact: true });
		await trigger.scrollIntoViewIfNeeded();
		await trigger.click();
		const tooltip = page.getByRole('tooltip');
		await expect(tooltip).toBeVisible();
		await expect(tooltip).toContainText('mistério central');

		const box = await tooltip.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		const debug = await tooltip.evaluate((element) => {
			const computed = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return {
				rect: { x: rect.x, width: rect.width, right: rect.right },
				style: element.getAttribute('style'),
				width: computed.width,
				maxWidth: computed.maxWidth,
				boxSizing: computed.boxSizing,
				clientWidth: document.documentElement.clientWidth,
				innerWidth: window.innerWidth,
			};
		});
		expect(box!.x + box!.width, JSON.stringify(debug)).toBeLessThanOrEqual(320);
		const measure = await page.evaluate(() => ({
			fits: document.documentElement.scrollWidth <= window.innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		expect(measure.fits).toBe(true);
	});

	test('reduced motion removes tooltip transitions', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/app');
		await page.waitForLoadState('networkidle');

		const trigger = page.getByRole('button', { name: 'Ajuda sobre Episódios', exact: true });
		const duration = await trigger.evaluate(
			(element) => getComputedStyle(element).transitionDuration,
		);
		const values = duration.split(',').map((value) => parseFloat(value));
		expect(Math.max(...values)).toBeLessThanOrEqual(0.02);
		await trigger.hover();
		await expect(page.getByRole('tooltip')).toBeVisible();
		const panelAnimation = await page
			.getByRole('tooltip')
			.evaluate((element) => getComputedStyle(element).animationName);
		expect(panelAnimation).toBe('none');
	});
});
