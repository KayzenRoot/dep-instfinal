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
		const measure = await page.evaluate(() => ({
			fits: document.documentElement.scrollWidth <= window.innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
			offenders: Array.from(document.querySelectorAll('body *'))
				.filter((element) => {
					const rect = element.getBoundingClientRect();
					return rect.right > window.innerWidth + 1 || rect.width > window.innerWidth + 1;
				})
				.slice(0, 8)
				.map((element) => ({
					tag: element.tagName.toLowerCase(),
					class: String(element.getAttribute('class') ?? '').slice(0, 80),
					right: Math.round(element.getBoundingClientRect().right),
					width: Math.round(element.getBoundingClientRect().width),
				})),
		}));
		expect(
			measure.fits,
			`${input.prefix} should not overflow at ${width}px (scroll ${measure.scrollWidth} > ${measure.innerWidth}; ${JSON.stringify(measure.offenders)})`,
		).toBe(true);
		await page.screenshot({
			path: path.join(screenshotDirectory, `${input.prefix}-${width}.png`),
			fullPage: true,
		});
	}
}
