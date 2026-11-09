import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ownerId = process.argv[2]?.trim();
if (
	!ownerId ||
	!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)
) {
	throw new Error('Usage: node scripts/set-owner-uid.mjs <Supabase Auth user UUID>');
}

const envPath = resolve(process.cwd(), '.env');
const examplePath = resolve(process.cwd(), '.env.example');
if (existsSync(envPath) && lstatSync(envPath).isSymbolicLink()) {
	throw new Error('Refusing to write through a symbolic link at .env.');
}
if (!existsSync(envPath) && !existsSync(examplePath)) {
	throw new Error('Neither .env nor .env.example exists in the current directory.');
}

const source = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8');
const lines = source.split(/\r?\n/);
const ownerEntries = lines.reduce((indices, line, index) => {
	if (/^\s*SUPABASE_OWNER_USER_ID\s*=/.test(line)) indices.push(index);
	return indices;
}, []);
if (ownerEntries.length > 1) {
	throw new Error('Refusing to update .env because it contains multiple owner UID entries.');
}

if (ownerEntries.length === 1) {
	lines[ownerEntries[0]] = `SUPABASE_OWNER_USER_ID=${ownerId}`;
} else {
	lines.push(`SUPABASE_OWNER_USER_ID=${ownerId}`);
}

const trailingNewline = source.endsWith('\n') ? '\n' : '';
const temporaryPath = `${envPath}.tmp`;
writeFileSync(temporaryPath, `${lines.join('\n').replace(/\r/g, '')}${trailingNewline}`, {
	encoding: 'utf8',
	mode: 0o600,
});
renameSync(temporaryPath, envPath);
process.stdout.write(
	'Configured the owner UID in .env. No credentials were written or displayed.\n',
);
