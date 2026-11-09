import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAppConfig } from '#lib/server/config.js';
import { checkRateLimit } from '#lib/server/rate-limit.js';
import { recoveryEmailSchema } from '#lib/schemas/auth.js';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.owner) redirect(303, '/auth/update-password');
	return { configured: locals.supabaseConfigured && locals.ownerConfigured };
};

export const actions: Actions = {
	default: async (event) => {
		const config = getAppConfig();
		if (!event.locals.supabase || !config.ownerUserId) {
			return fail(503, { message: 'A recuperação ainda não está configurada.', email: '' });
		}

		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			// Keep the shared fallback bucket when the adapter cannot supply the client address.
		}
		const limit = checkRateLimit(`recovery:${ip}`, 3, 15 * 60 * 1000);
		if (!limit.allowed) {
			return fail(429, {
				message: 'Muitas tentativas. Aguarde antes de solicitar outra recuperação.',
				email: '',
			});
		}

		let raw: FormData;
		try {
			raw = await event.request.formData();
		} catch {
			return fail(400, { message: 'Não foi possível ler o formulário.', email: '' });
		}

		const parsed = recoveryEmailSchema.safeParse({ email: raw.get('email') });
		if (!parsed.success) {
			return fail(400, { message: 'Informe um e-mail válido.', email: '' });
		}

		const origin = config.appOrigin ?? (import.meta.env.DEV ? event.url.origin : undefined);
		if (!origin)
			return fail(503, {
				message: 'O endereço seguro de recuperação não está configurado.',
				email: '',
			});

		await event.locals.supabase.auth.resetPasswordForEmail(parsed.data.email, {
			redirectTo: `${origin}/auth/callback?next=%2Fauth%2Fupdate-password`,
		});

		return {
			message: 'Se esta conta estiver habilitada, enviaremos as instruções de recuperação.',
			email: '',
		};
	},
};
