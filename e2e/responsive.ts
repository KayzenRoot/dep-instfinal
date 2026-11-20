import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function captureResponsivePages(
	page: Page,
	input: { url: string; heading: string; prefix: string },
): Promise<void> {
	const screenshotDirectory = path.join(process.cwd(), 'test-results', 'screenshots');
	await mkdir(screenshotDirectory, { recursive: true });
	for (const width of [360, 768, 1440]) {
		await page.goto(input.url);
		await page.setViewportSize({ width, height: 900 });
		await expect(page.getByRole('heading', { name: input.heading })).toBeVisible();
		const fits = await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		);
		expect(fits, `${input.prefix} should not overflow at ${width}px`).toBe(true);
		await page.screenshot({
			path: path.join(screenshotDirectory, `${input.prefix}-${width}.png`),
			fullPage: true,
		});
	}
}
