import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export function requireOwner(event: RequestEvent): NonNullable<App.Locals['owner']> {
	if (!event.locals.supabaseConfigured || !event.locals.ownerConfigured) {
		redirect(303, '/login?setup=required');
	}
	if (!event.locals.owner) {
		if (event.url.pathname.startsWith('/api/')) error(401, 'Authentication required');
		redirect(303, '/login');
	}
	return event.locals.owner;
}
