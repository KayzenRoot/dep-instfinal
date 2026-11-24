import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, groupLabelForPath, isActivePath } from './nav-items';

function topLevelAppRoutes(): string[] {
	const root = join('src', 'routes', 'app');
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, '+page.svelte')))
		.map((entry) => `/app/${entry.name}`);
}

describe('Neon Glass navigation model', () => {
	it('keeps every top-level application route reachable', () => {
		const expected = new Set(['/app', ...topLevelAppRoutes()]);
		const actual = new Set(NAV_ITEMS.map((item) => item.path));
		expect(actual).toEqual(expected);
	});

	it('has unique paths and labels across ordered groups', () => {
		const paths = NAV_ITEMS.map((item) => item.path);
		expect(new Set(paths).size).toBe(paths.length);
		expect(NAV_GROUPS).toHaveLength(6);
		for (const group of NAV_GROUPS) {
			expect(group.items.length).toBeGreaterThan(0);
			expect(group.label.trim()).not.toBe('');
			for (const item of group.items) {
				expect(item.path.startsWith('/app')).toBe(true);
				expect(item.label.trim()).not.toBe('');
			}
		}
	});

	it('keeps the mobile dock limited to the five quick destinations', () => {
		const quick = NAV_ITEMS.filter((item) => item.quick);
		expect(quick.map((item) => item.label)).toEqual([
			'Painel',
			'Séries',
			'Episódios',
			'Timeline',
			'Exportar',
		]);
	});

	it('matches exact routes and their children without prefix collisions', () => {
		expect(isActivePath('/app', '/app')).toBe(true);
		expect(isActivePath('/app/series', '/app')).toBe(false);
		expect(isActivePath('/app/series/123', '/app/series')).toBe(true);
		expect(isActivePath('/app/series-archive', '/app/series')).toBe(false);
		expect(isActivePath('/app/continuity/visual', '/app/continuity')).toBe(true);
		expect(isActivePath('/app/settings/', '/app/settings')).toBe(true);
	});

	it('derives the current section label for the topbar', () => {
		expect(groupLabelForPath('/app')).toBe('Visão geral');
		expect(groupLabelForPath('/app/identity')).toBe('Cânone e análise');
		expect(groupLabelForPath('/app/timeline/123')).toBe('Produção');
		expect(groupLabelForPath('/login')).toBe('Estúdio');
	});
});
