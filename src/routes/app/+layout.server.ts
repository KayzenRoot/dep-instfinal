import type { LayoutServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';

export const load: LayoutServerLoad = (event) => {
	const { owner } = ownerDatabase(event);
	return {
		ownerLabel: owner.email ?? 'Proprietária',
		currentPath: event.url.pathname,
	};
};
