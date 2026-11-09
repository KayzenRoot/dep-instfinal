import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) =>
	Response.json(
		{
			status: 'ok',
			configured: { supabase: locals.supabaseConfigured, owner: locals.ownerConfigured },
		},
		{ headers: { 'cache-control': 'no-store' } },
	);
