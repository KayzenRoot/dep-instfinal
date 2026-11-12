import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { newPasswordSchema } from '#lib/schemas/auth.js';
import { requireOwner } from '#lib/server/owner.js';

export const load: PageServerLoad = (event) => {
	requireOwner(event);
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		requireOwner(event);
		const parsedForm = await event.request.formData().catch(() => null);
		if (!parsedForm) return fail(400, { message: 'Não foi possível ler o formulário.' });

		const parsed = newPasswordSchema.safeParse({
			password: parsedForm.get('password'),
			confirmPassword: parsedForm.get('confirmPassword'),
		});
		if (!parsed.success) {
			return fail(400, { message: parsed.error.issues[0]?.message ?? 'Senha inválida.' });
		}
		if (!event.locals.supabase) return fail(503, { message: 'Supabase Auth indisponível.' });

		const { error: updateError } = await event.locals.supabase.auth.updateUser({
			password: parsed.data.password,
		});
		if (updateError) return fail(400, { message: 'Não foi possível atualizar a senha.' });

		await event.locals.supabase.auth.signOut({ scope: 'global' });
		redirect(303, '/login?password=updated');
	},
};
