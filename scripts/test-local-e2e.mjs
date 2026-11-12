import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function parseEnvironment(output) {
	return Object.fromEntries(
		output
			.split(/\r?\n/)
			.map((line) => line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/))
			.filter(Boolean)
			.map(([, name, rawValue]) => {
				const value = rawValue.trim();
				return [name, value.startsWith('"') ? JSON.parse(value) : value.replace(/^'|'$/g, '')];
			}),
	);
}

function readSupabaseEnvironment() {
	const options = {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	};

	try {
		const output =
			process.platform === 'win32'
				? execFileSync(
						process.env.ComSpec ?? 'cmd.exe',
						['/d', '/s', '/c', 'supabase status --output env'],
						options,
					)
				: execFileSync('supabase', ['status', '--output', 'env'], options);
		return parseEnvironment(output);
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.error('Supabase CLI was not found on PATH. Install it and run `supabase start`.');
			process.exit(1);
		}
		console.error(
			'Could not read the local Supabase stack. Ensure Docker Desktop is running and `supabase start` completed successfully before retrying.',
		);
		process.exit(1);
	}
}

function readOptionalEnvironment(path) {
	try {
		return parseEnvironment(readFileSync(path, 'utf8'));
	} catch {
		return {};
	}
}

const localEnvironment = readSupabaseEnvironment();
const apiUrl = new URL(localEnvironment.API_URL ?? '');
if (
	!['localhost', '127.0.0.1'].includes(apiUrl.hostname) ||
	apiUrl.port !== '54321' ||
	!localEnvironment.ANON_KEY ||
	!localEnvironment.SERVICE_ROLE_KEY
) {
	throw new Error('The local E2E runner only accepts the Supabase CLI stack on port 54321.');
}

const useR2 = process.env.E2E_R2 === '1';
const r2Environment = useR2
	? readOptionalEnvironment(process.env.R2_ENV_FILE ?? 'C:/Users/csn19/.zcode/dif-secrets/r2.env')
	: {};
if (useR2) {
	for (const key of [
		'R2_ACCOUNT_ID',
		'R2_ACCESS_KEY_ID',
		'R2_SECRET_ACCESS_KEY',
		'R2_BUCKET',
		'R2_ENDPOINT',
	]) {
		if (!r2Environment[key]) throw new Error(`E2E_R2=1 requires ${key} in R2_ENV_FILE.`);
	}
}

const runId = randomBytes(6).toString('hex');
const ownerEmail = `owner-${runId}@example.test`;
const ownerPassword = randomBytes(24).toString('base64url');
const otherEmail = `non-owner-${runId}@example.test`;
const otherPassword = randomBytes(24).toString('base64url');

async function createLocalUser(email, password, isOwner = false) {
	const response = await fetch(new URL('/auth/v1/admin/users', apiUrl), {
		method: 'POST',
		headers: {
			apikey: localEnvironment.SERVICE_ROLE_KEY,
			Authorization: `Bearer ${localEnvironment.SERVICE_ROLE_KEY}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			email,
			password,
			email_confirm: true,
			app_metadata: isOwner ? { dif_studio_owner: true } : {},
		}),
	});
	if (!response.ok) {
		throw new Error(`The local Auth admin endpoint returned HTTP ${response.status}.`);
	}
	const user = await response.json();
	if (!user.id) throw new Error('Local Auth did not return the synthetic user ID.');
	return user.id;
}

async function verifyLocalPasswordGrant(email, password, expectedUserId) {
	const response = await fetch(new URL('/auth/v1/token?grant_type=password', apiUrl), {
		method: 'POST',
		headers: {
			apikey: localEnvironment.ANON_KEY,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		const safeCode =
			[payload.error_code, payload.error, payload.msg, payload.code].find(
				(candidate) => typeof candidate === 'string' && /^[a-z0-9_-]{1,48}$/i.test(candidate),
			) ?? 'unknown';
		throw new Error(
			`Local Auth rejected a synthetic password grant with HTTP ${response.status} (${safeCode}).`,
		);
	}
	const session = await response.json();
	if (session.user?.id !== expectedUserId) {
		throw new Error('Local Auth returned an unexpected synthetic identity.');
	}
	return session.access_token;
}

const ownerId = await createLocalUser(ownerEmail, ownerPassword, true);
const otherId = await createLocalUser(otherEmail, otherPassword);
const ownerToken = await verifyLocalPasswordGrant(ownerEmail, ownerPassword, ownerId);
const otherToken = await verifyLocalPasswordGrant(otherEmail, otherPassword, otherId);

async function postgrest(path, accessToken, method, body) {
	return fetch(new URL(`/rest/v1/${path}`, apiUrl), {
		method,
		headers: {
			apikey: localEnvironment.ANON_KEY,
			Authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json',
			Prefer: 'return=representation',
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

const dataApiOwnerWrite = await postgrest('series?select=id,title', ownerToken, 'POST', {
	title: `RLS Data API ${runId}`,
});
if (!dataApiOwnerWrite.ok) {
	throw new Error(
		`The owner identity could not write through the Supabase Data API (HTTP ${dataApiOwnerWrite.status}).`,
	);
}
const dataApiOtherRead = await postgrest('series?select=id,title', otherToken, 'GET');
if (!dataApiOtherRead.ok || (await dataApiOtherRead.json()).length !== 0) {
	throw new Error('The non-owner identity could read owner records through the Supabase Data API.');
}
const dataApiOtherWrite = await postgrest('series?select=id', otherToken, 'POST', {
	title: `Non-owner attempt ${runId}`,
});
if (dataApiOtherWrite.ok) {
	throw new Error('The non-owner identity could write through the Supabase Data API.');
}

const childEnvironment = {
	PATH: process.env.PATH,
	CI: process.env.CI ?? '',
	DEBUG: process.env.DEBUG ?? '',
	HOME: process.env.HOME ?? '',
	USERPROFILE: process.env.USERPROFILE ?? '',
	LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
	TEMP: process.env.TEMP ?? '',
	TMP: process.env.TMP ?? '',
	SystemRoot: process.env.SystemRoot ?? '',
	PUBLIC_SUPABASE_URL: apiUrl.origin,
	PUBLIC_SUPABASE_ANON_KEY: localEnvironment.ANON_KEY,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
	SUPABASE_OWNER_USER_ID: ownerId,
	APP_ORIGIN: 'http://127.0.0.1:4173',
	CLOUDINARY_CLOUD_NAME: '',
	CLOUDINARY_API_KEY: '',
	CLOUDINARY_API_SECRET: '',
	VIDEO_STORAGE_DRIVER: useR2 ? 'r2' : 'memory',
	VIDEO_PROBE_DRIVER: 'fixture',
	MAX_VIDEO_MB: '200',
	VIDEO_PART_SIZE_MB: '8',
	R2_ACCOUNT_ID: r2Environment.R2_ACCOUNT_ID ?? '',
	R2_ACCESS_KEY_ID: r2Environment.R2_ACCESS_KEY_ID ?? '',
	R2_SECRET_ACCESS_KEY: r2Environment.R2_SECRET_ACCESS_KEY ?? '',
	R2_BUCKET: r2Environment.R2_BUCKET ?? '',
	R2_ENDPOINT: r2Environment.R2_ENDPOINT ?? '',
	E2E_OWNER_EMAIL: ownerEmail,
	E2E_OWNER_PASSWORD: ownerPassword,
	E2E_OTHER_EMAIL: otherEmail,
	E2E_OTHER_PASSWORD: otherPassword,
};

const runner = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const extraArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, [runner, 'test', ...extraArgs], {
	cwd: process.cwd(),
	env: childEnvironment,
	stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
