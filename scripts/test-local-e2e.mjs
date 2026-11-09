import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

const runId = randomBytes(6).toString('hex');
const ownerEmail = `owner-${runId}@example.test`;
const ownerPassword = randomBytes(24).toString('base64url');
const otherEmail = `non-owner-${runId}@example.test`;
const otherPassword = randomBytes(24).toString('base64url');

async function createLocalUser(email, password) {
	const response = await fetch(new URL('/auth/v1/admin/users', apiUrl), {
		method: 'POST',
		headers: {
			apikey: localEnvironment.SERVICE_ROLE_KEY,
			Authorization: `Bearer ${localEnvironment.SERVICE_ROLE_KEY}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ email, password, email_confirm: true }),
	});
	if (!response.ok) {
		throw new Error(`The local Auth admin endpoint returned HTTP ${response.status}.`);
	}
	const user = await response.json();
	if (!user.id) throw new Error('Local Auth did not return the synthetic user ID.');
	return user.id;
}

const ownerId = await createLocalUser(ownerEmail, ownerPassword);
await createLocalUser(otherEmail, otherPassword);

const childEnvironment = {
	PATH: process.env.PATH,
	CI: process.env.CI ?? '',
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
	E2E_OWNER_EMAIL: ownerEmail,
	E2E_OWNER_PASSWORD: ownerPassword,
	E2E_OTHER_EMAIL: otherEmail,
	E2E_OTHER_PASSWORD: otherPassword,
};

const runner = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const result = spawnSync(process.execPath, [runner, 'test'], {
	cwd: process.cwd(),
	env: childEnvironment,
	stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
