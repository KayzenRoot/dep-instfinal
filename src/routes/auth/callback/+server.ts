import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '#lib/server/config.js';

function safeNext(value: string | null): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
		return '/app';
	try {
		const target = new URL(value, 'https://dif-studio.invalid');
		return target.origin === 'https://dif-studio.invalid'
			? `${target.pathname}${target.search}${target.hash}`
			: '/app';
	} catch {
		return '/app';
	}
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const config = getAppConfig();
	const code = url.searchParams.get('code');
	if (!code || !locals.supabase || !config.ownerUserId) redirect(303, '/login?auth=failed');

	const { error: exchangeError } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (exchangeError) redirect(303, '/login?auth=failed');

	const { data, error: userError } = await locals.supabase.auth.getUser();
	if (userError || !data.user || data.user.id !== config.ownerUserId) {
		await locals.supabase.auth.signOut({ scope: 'global' });
		redirect(303, '/login?auth=denied');
	}

	redirect(303, safeNext(url.searchParams.get('next')));
};
