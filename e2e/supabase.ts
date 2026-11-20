import type { APIRequestContext } from '@playwright/test';

export const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
export const ownerId = process.env.SUPABASE_OWNER_USER_ID;

export async function insertRow(
	request: APIRequestContext,
	token: string,
	table: string,
	row: Record<string, unknown>,
): Promise<void> {
	if (!supabaseUrl || !serviceKey) throw new Error('missing local Supabase env');
	const response = await request.post(`${supabaseUrl}/rest/v1/${table}`, {
		headers: {
			apikey: anonKey ?? serviceKey,
			Authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			Prefer: 'return=representation',
		},
		data: row,
	});
	if (!response.ok()) throw new Error(`${table}: ${await response.text()}`);
}

export async function ownerAccessToken(request: APIRequestContext): Promise<string> {
	if (!supabaseUrl || !anonKey) throw new Error('missing local Supabase anon env');
	const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
		headers: { apikey: anonKey, 'content-type': 'application/json' },
		data: {
			email: process.env.E2E_OWNER_EMAIL,
			password: process.env.E2E_OWNER_PASSWORD,
		},
	});
	if (!response.ok()) throw new Error(await response.text());
	return ((await response.json()) as { access_token: string }).access_token;
}
