#!/usr/bin/env node
// Read-only production smoke: public surface, private boundaries and the V2 schema
// markers. Run after hosted migrations; exits non-zero while the schema is V1.
import process from 'node:process';

const baseUrl = (process.env.PROD_BASE_URL ?? 'https://dif-studio.vercel.app').replace(/\/$/, '');
const supabaseUrl = (process.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const supabaseKey =
	process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const v2Tables = [
	'video_assets',
	'video_edit_plans',
	'render_jobs',
	'cover_revisions',
	'choice_end_cards',
	'published_posts',
	'style_presets',
];

function fail(message) {
	console.error(`FAIL ${message}`);
	process.exitCode = 1;
}
function pass(message) {
	console.log(`PASS ${message}`);
}

async function get(url, options = {}) {
	return fetch(url, { ...options, signal: AbortSignal.timeout(20_000), redirect: 'manual' });
}

const health = await get(`${baseUrl}/health`);
if (health.status === 200) {
	const body = await health.json().catch(() => ({}));
	if (body?.status === 'ok' && body?.configured?.supabase === true) pass('health');
	else fail(`health payload ${JSON.stringify(body)}`);
} else fail(`health HTTP ${health.status}`);

const login = await get(`${baseUrl}/login`);
if (login.status === 200 && (await login.text()).includes('E-mail do proprietário')) pass('login');
else fail(`login HTTP ${login.status}`);

for (const path of [
	'/api/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	'/api/video/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	'/api/render-jobs/health',
	'/api/style/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
]) {
	const response = await get(`${baseUrl}${path}`);
	if ([401, 403, 404].includes(response.status)) pass(`anonymous boundary ${path}`);
	else fail(`anonymous boundary ${path} HTTP ${response.status}`);
}

if (!supabaseUrl || !supabaseKey) {
	fail('PUBLIC_SUPABASE_URL and publishable/anon key are required for schema probe');
} else {
	for (const table of v2Tables) {
		const response = await get(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
			headers: { apikey: supabaseKey },
		});
		if (response.status === 404) fail(`schema missing table ${table}`);
		else if ([200, 401, 403].includes(response.status)) pass(`schema table ${table}`);
		else fail(`schema probe ${table} HTTP ${response.status}`);
	}
}

if (process.exitCode) console.error('Smoke failed; do not declare the release complete.');
else console.log('Smoke passed.');
