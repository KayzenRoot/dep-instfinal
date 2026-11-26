import { describe, expect, it } from 'vitest';
import { computeTooltipPosition, tooltipWidth } from './tooltip-position';

const trigger = { left: 100, right: 130, top: 100, bottom: 124, width: 30, height: 24 };

describe('tooltip positioning', () => {
	it('uses a 320px cap and reserves viewport margins at 320px', () => {
		expect(tooltipWidth(320)).toBe(304);
		const position = computeTooltipPosition(trigger, 160, 320, 800);
		expect(position.width).toBe(304);
		expect(position.left).toBe(8);
		expect(position.left + position.width).toBeLessThanOrEqual(320);
	});

	it('clamps the right edge when the trigger is on the right', () => {
		const rightTrigger = { ...trigger, left: 280, right: 310, width: 30 };
		const position = computeTooltipPosition(rightTrigger, 160, 320, 800);
		expect(position.left).toBe(8);
		expect(position.left + position.width).toBeLessThanOrEqual(320);
	});

	it('flips above when there is no room below', () => {
		const lowTrigger = { ...trigger, top: 700, bottom: 724 };
		const position = computeTooltipPosition(lowTrigger, 300, 1440, 800);
		expect(position.top).toBe(392);
	});

	it('keeps a desktop tooltip near the trigger center', () => {
		const position = computeTooltipPosition(trigger, 160, 1440, 900);
		expect(position.width).toBe(320);
		expect(position.left).toBe(8);
	});
});
