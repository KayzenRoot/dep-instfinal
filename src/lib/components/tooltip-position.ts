export interface TooltipTriggerRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

export interface TooltipPosition {
	left: number;
	top: number;
	width: number;
}

export function tooltipWidth(viewportWidth: number, margin = 8): number {
	return Math.min(320, Math.max(0, viewportWidth - margin * 2));
}

/**
 * Places a read-only tooltip below the trigger, flips it above when needed and
 * clamps both axes to the visual viewport. Pure so the 320px contract and the
 * edge cases can be unit-tested without a DOM.
 */
export function computeTooltipPosition(
	trigger: TooltipTriggerRect,
	panelHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	margin = 8,
): TooltipPosition {
	const width = tooltipWidth(viewportWidth, margin);
	let left = Math.round(trigger.left + trigger.width / 2 - width / 2);
	left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
	let top = Math.round(trigger.bottom + margin);
	if (top + panelHeight > viewportHeight - margin) {
		top = Math.round(trigger.top - panelHeight - margin);
	}
	top = Math.max(margin, Math.min(top, viewportHeight - panelHeight - margin));
	return { left, top, width };
}
