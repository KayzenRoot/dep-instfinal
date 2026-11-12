import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAppConfig } from '#lib/server/config.js';
import { checkRateLimit, resetRateLimit } from '#lib/server/rate-limit.js';
import { loginCredentialsSchema } from '#lib/schemas/auth.js';

function requestIp(event: Parameters<Actions['default']>[0]): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

export const load: PageServerLoad = ({ locals }) => {
	if (locals.owner) redirect(303, '/app');
	return {
		supabaseConfigured: locals.supabaseConfigured,
		ownerConfigured: locals.ownerConfigured,
	};
};

export const actions: Actions = {
	default: async (event) => {
		const config = getAppConfig();
		if (!event.locals.supabase || !config.ownerUserId) {
			return fail(503, {
				message: 'O acesso ainda não foi configurado para este estúdio.',
				email: '',
			});
		}

		const ip = requestIp(event);
		const limit = checkRateLimit(`login:${ip}`, 6, 15 * 60 * 1000);
		if (!limit.allowed) {
			return fail(429, {
				message: 'Muitas tentativas. Aguarde antes de tentar novamente.',
				email: '',
				retryAfterSeconds: limit.retryAfterSeconds,
			});
		}

		let raw: FormData;
		try {
			raw = await event.request.formData();
		} catch {
			return fail(400, { message: 'Não foi possível ler o formulário.', email: '' });
		}

		const parsed = loginCredentialsSchema.safeParse({
			email: raw.get('email'),
			password: raw.get('password'),
		});
		if (!parsed.success) {
			return fail(400, {
				message: 'Informe um e-mail válido e uma senha.',
				email:
					typeof raw.get('email') === 'string' ? raw.get('email')!.toString().slice(0, 254) : '',
			});
		}

		const { error: signInError } = await event.locals.supabase.auth.signInWithPassword(parsed.data);
		if (signInError) {
			return fail(401, {
				message: 'Não foi possível autenticar esta conta.',
				email: parsed.data.email,
			});
		}

		const { data, error: userError } = await event.locals.supabase.auth.getUser();
		if (userError || !data.user || data.user.id !== config.ownerUserId) {
			await event.locals.supabase.auth.signOut({ scope: 'global' });
			return fail(401, {
				message: 'Não foi possível autenticar esta conta.',
				email: parsed.data.email,
			});
		}

		resetRateLimit(`login:${ip}`);
		redirect(303, '/app');
	},
};
