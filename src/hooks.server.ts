import type { Handle } from '@sveltejs/kit/hooks';
import { getAppConfig } from '#lib/server/config.js';
import { createSupabaseServerClient } from '#lib/server/supabase.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function responseWithSecurityHeaders(response: Response, cacheControl: string): Response {
	const headers = new Headers(response.headers);
	headers.set('cache-control', cacheControl);
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	headers.set('x-frame-options', 'DENY');
	headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const config = getAppConfig();
	const supabase = createSupabaseServerClient(event);
	event.locals.supabase = supabase;
	event.locals.supabaseUser = null;
	event.locals.owner = null;
	event.locals.supabaseConfigured = config.supabaseConfigured;
	event.locals.ownerConfigured = config.ownerConfigured;

	if (supabase && config.ownerUserId) {
		try {
			const { data, error: authError } = await supabase.auth.getUser();
			if (!authError && data.user) {
				event.locals.supabaseUser = data.user;
				if (
					data.user.id === config.ownerUserId &&
					data.user.app_metadata?.dif_studio_owner === true
				)
					event.locals.owner = data.user;
			}
		} catch {
			// A failed remote auth check fails closed; protected pages will redirect to login.
		}
	}

	if (MUTATING_METHODS.has(event.request.method)) {
		const originHeader = event.request.headers.get('origin');
		const trustedOrigin = config.appOrigin ?? (import.meta.env.DEV ? event.url.origin : undefined);
		let requestOrigin: string | undefined;
		try {
			requestOrigin = originHeader ? new URL(originHeader).origin : undefined;
		} catch {
			requestOrigin = undefined;
		}

		if (!trustedOrigin || !requestOrigin || requestOrigin !== trustedOrigin) {
			return responseWithSecurityHeaders(
				new Response('Origin check failed', { status: 403 }),
				'no-store',
			);
		}
	}

	const response = await resolve(event);
	return responseWithSecurityHeaders(response, 'private, no-store');
};
