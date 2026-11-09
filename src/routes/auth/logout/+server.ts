import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (locals.supabase) await locals.supabase.auth.signOut({ scope: 'global' });
	redirect(303, '/login?logged-out=1');
};
