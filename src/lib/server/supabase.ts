import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { getAppConfig } from './config.js';

export function createSupabaseServerClient(event: RequestEvent): SupabaseClient | null {
	const config = getAppConfig();
	if (!config.supabaseConfigured || !config.supabaseUrl || !config.supabasePublishableKey) {
		return null;
	}

	const secure = event.url.protocol === 'https:';
	return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
		cookieOptions: {
			name: 'dif-studio-auth',
			path: '/',
			httpOnly: true,
			secure,
			sameSite: 'lax',
		},
		global: { fetch: event.fetch },
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, {
						...options,
						path: '/',
						httpOnly: true,
						secure,
						sameSite: 'lax',
					});
				}
			},
		},
	});
}
