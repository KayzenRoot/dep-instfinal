import type { PageServerLoad } from './$types';
import { createTextProvider } from '#lib/providers/text-provider.js';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';

export const load: PageServerLoad = async (event) => {
	const { owner } = ownerDatabase(event);
	const config = getAppConfig();
	return {
		ownerLabel: owner.email ?? 'Proprietária',
		integrations: {
			supabase: config.supabaseConfigured,
			owner: config.ownerConfigured,
			cloudinary: config.cloudinaryConfigured,
			textProvider: await createTextProvider().status(),
		},
	};
};
