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

/**
 * Ordered navigation model. Every top-level /app route must remain reachable
 * from a group; the mobile dock only repeats a small `quick` subset while the
 * drawer keeps the complete tree.
 */
export const NAV_GROUPS: NavGroup[] = [
	{
		id: 'overview',
		label: 'Visão geral',
		items: [{ path: '/app', label: 'Painel', glyph: 'archive', quick: true }],
	},
	{
		id: 'production',
		label: 'Produção',
		items: [
			{ path: '/app/series', label: 'Séries', glyph: 'book', quick: true },
			{ path: '/app/episodes', label: 'Episódios', glyph: 'film', quick: true },
			{ path: '/app/editor', label: 'Editor', glyph: 'frames' },
			{ path: '/app/storyboard', label: 'Storyboard', glyph: 'frames' },
			{ path: '/app/timeline', label: 'Timeline', glyph: 'frames', quick: true },
			{ path: '/app/director', label: 'Diretor', glyph: 'branch' },
			{ path: '/app/hooks', label: 'Hook Lab', glyph: 'branch' },
		],
	},
	{
		id: 'visual',
		label: 'Visual',
		items: [
			{ path: '/app/covers', label: 'Capas', glyph: 'frames' },
			{ path: '/app/style', label: 'Estilo', glyph: 'book' },
			{ path: '/app/library', label: 'Biblioteca visual', glyph: 'library' },
			{ path: '/app/color', label: 'Cor', glyph: 'frames' },
			{ path: '/app/video', label: 'Clipes', glyph: 'film' },
		],
	},
	{
		id: 'audio-text',
		label: 'Áudio e texto',
		items: [
			{ path: '/app/narration', label: 'Narração', glyph: 'archive' },
			{ path: '/app/audio', label: 'Áudio', glyph: 'archive' },
			{ path: '/app/captions', label: 'Legendas', glyph: 'book' },
		],
	},
	{
		id: 'canon-analytics',
		label: 'Cânone e análise',
		items: [
			{ path: '/app/identity', label: 'Identidade', glyph: 'book' },
			{ path: '/app/continuity', label: 'Votações e cânone', glyph: 'branch' },
			{ path: '/app/finale', label: 'Final A/B', glyph: 'branch' },
			{ path: '/app/retention', label: 'Retenção', glyph: 'archive' },
		],
	},
	{
		id: 'system',
		label: 'Sistema',
		items: [
			{ path: '/app/export', label: 'Exportar', glyph: 'export', quick: true },
			{ path: '/app/settings', label: 'Configurações', glyph: 'settings' },
		],
	},
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function normalizePath(path: string): string {
	const normalized = path.replace(/\/+$/, '');
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
