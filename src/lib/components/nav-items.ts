import type { GlyphName } from './glyph';

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

function navItem(path: string, label: string, glyph: GlyphName, quick = false): NavItem {
	const item: NavItem = { path, label, glyph };
	if (quick) item.quick = true;
	return item;
}

/**
 * Ordered navigation model. Every top-level /app route must remain reachable
 * from a group; the mobile dock only repeats a small `quick` subset while the
 * drawer keeps the complete tree.
 */
export const NAV_GROUPS: NavGroup[] = [
	{
		id: 'overview',
		label: 'Visão geral',
		items: [navItem('/app', 'Painel', 'archive', true)],
	},
	{
		id: 'production',
		label: 'Produção',
		items: [
			navItem('/app/series', 'Séries', 'book', true),
			navItem('/app/episodes', 'Episódios', 'film', true),
			navItem('/app/editor', 'Editor', 'frames'),
			navItem('/app/storyboard', 'Storyboard', 'frames'),
			navItem('/app/timeline', 'Timeline', 'frames', true),
			navItem('/app/director', 'Diretor', 'branch'),
			navItem('/app/hooks', 'Hook Lab', 'branch'),
		],
	},
	{
		id: 'visual',
		label: 'Visual',
		items: [
			navItem('/app/covers', 'Capas', 'frames'),
			navItem('/app/style', 'Estilo', 'book'),
			navItem('/app/library', 'Biblioteca visual', 'library'),
			navItem('/app/color', 'Cor', 'frames'),
			navItem('/app/video', 'Clipes', 'film'),
		],
	},
	{
		id: 'audio-text',
		label: 'Áudio e texto',
		items: [
			navItem('/app/narration', 'Narração', 'archive'),
			navItem('/app/audio', 'Áudio', 'archive'),
			navItem('/app/captions', 'Legendas', 'book'),
		],
	},
	{
		id: 'canon-analytics',
		label: 'Cânone e análise',
		items: [
			navItem('/app/identity', 'Identidade', 'book'),
			navItem('/app/continuity', 'Votações e cânone', 'branch'),
			navItem('/app/finale', 'Final A/B', 'branch'),
			navItem('/app/retention', 'Retenção', 'archive'),
		],
	},
	{
		id: 'system',
		label: 'Sistema',
		items: [
			navItem('/app/export', 'Exportar', 'export', true),
			navItem('/app/settings', 'Configurações', 'settings'),
		],
	},
];

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
