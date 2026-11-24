import { GLYPH_NAMES, type GlyphName } from './glyph';
import rawNav from './nav-items.json';

export interface NavItem {
	path: string;
	label: string;
	glyph: GlyphName;
	quick?: boolean;
}

export interface NavGroup {
	id: string;
	label: string;
	items: NavItem[];
}

interface RawNavItem {
	path: string;
	label: string;
	glyph: string;
	quick?: boolean;
}

interface RawNavGroup {
	id: string;
	label: string;
	items: RawNavItem[];
}

function toGlyph(value: string): GlyphName {
	if ((GLYPH_NAMES as readonly string[]).includes(value)) {
		return value as GlyphName;
	}
	throw new Error(`Unknown navigation glyph: ${value}`);
}

function toNavItem(raw: RawNavItem): NavItem {
	const item: NavItem = { path: raw.path, label: raw.label, glyph: toGlyph(raw.glyph) };
	if (raw.quick === true) item.quick = true;
	return item;
}

/**
 * Declarative navigation data lives in `nav-items.json` so the table stays
 * readable and formatted normally. Every top-level /app route must remain
 * reachable from a group; the mobile dock only repeats a small `quick` subset.
 */
export const NAV_GROUPS: NavGroup[] = (rawNav as { groups: RawNavGroup[] }).groups.map((group) => ({
	id: group.id,
	label: group.label,
	items: group.items.map(toNavItem),
}));

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function normalizePath(path: string): string {
	let normalized = path;
	while (normalized.length > 1 && normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized || '/';
}

/** `/app` matches only the dashboard; deeper links also match their children. */
export function isActivePath(currentPath: string, targetPath: string): boolean {
	const current = normalizePath(currentPath);
	const target = normalizePath(targetPath);
	if (current === target) return true;
	return target !== '/app' && current.startsWith(`${target}/`);
}

export function groupForPath(path: string): NavGroup | undefined {
	return NAV_GROUPS.find((group) => group.items.some((item) => isActivePath(path, item.path)));
}

export function groupLabelForPath(path: string): string {
	return groupForPath(path)?.label ?? 'Estúdio';
}
