import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ids = [
	'01-login',
	'02-dashboard',
	'03-series',
	'04-episodes',
	'05-editor',
	'06-style',
	'07-media',
	'08-analytics',
	'09-settings',
];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function requireCondition(value, message) {
	if (!value) throw new Error(message);
}

export function verifyImages({ manifestPath, sourceDir, manifestOnly = false }) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	requireCondition(manifest.name === 'DIF Studio Neon Glass', 'Nome do master incorreto.');
	requireCondition(
		manifest.image_size?.width === 1672 && manifest.image_size?.height === 941,
		'Dimensões do master incorretas.',
	);
	requireCondition(
		Array.isArray(manifest.images) && manifest.images.length === 9,
		'O master precisa das nove imagens.',
	);
	const actualIds = manifest.images.map((entry) => entry.name);
	requireCondition(JSON.stringify(actualIds) === JSON.stringify(ids), 'IDs ou ordem incorretos.');
	const names = new Set();
	const hashes = new Set();
	for (const image of manifest.images) {
		requireCondition(image.file === 'screens/' + image.name + '.png', 'Caminho inválido.');
		requireCondition(/^[0-9a-f]{64}$/.test(image.sha256), 'Hash inválido.');
		requireCondition(!names.has(image.file), 'Caminho duplicado.');
		requireCondition(!hashes.has(image.sha256), 'Imagem duplicada.');
		names.add(image.file);
		hashes.add(image.sha256);
	}
	if (manifestOnly) return { verified: 0, total: 9, mode: 'manifest-only' };
	const root = sourceDir ? resolve(sourceDir) : dirname(resolve(manifestPath));
	for (const image of manifest.images) {
		const path = sourceDir
			? join(root, image.name + '.png')
			: join(root, image.file);
		const bytes = readFileSync(path);
		requireCondition(
			bytes.length >= 24 && bytes.subarray(0, 8).equals(signature),
			'Assinatura PNG inválida: ' + image.name,
		);
		requireCondition(bytes.toString('ascii', 12, 16) === 'IHDR', 'PNG sem IHDR.');
		requireCondition(
			bytes.readUInt32BE(16) === 1672 && bytes.readUInt32BE(20) === 941,
			'Dimensões incorretas: ' + image.name,
		);
		requireCondition(
			createHash('sha256').update(bytes).digest('hex') === image.sha256,
			'Hash divergente: ' + image.name,
		);
		if (!sourceDir) {
			requireCondition(image.exists_in_repo === true, 'Arquivo não promovido: ' + image.name);
		}
	}
	return { verified: 9, total: 9, mode: sourceDir ? 'source-dir' : 'repository' };
}

function parseArgs(args) {
	const options = {
		manifestPath: join(dirname(fileURLToPath(import.meta.url)), 'manifest.json'),
	};
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === '--manifest-only') options.manifestOnly = true;
		else if (args[i] === '--manifest' || args[i] === '--source-dir') {
			const key = args[i] === '--manifest' ? 'manifestPath' : 'sourceDir';
			const value = args[++i];
			requireCondition(Boolean(value), 'Valor do argumento ausente.');
			options[key] = value;
		} else throw new Error('Argumento desconhecido: ' + args[i]);
	}
	return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const status = verifyImages(parseArgs(process.argv.slice(2)));
		process.stdout.write(
			'DIF-UX-WO-001: ' + status.verified + '/9 imagens verificadas (' + status.mode + ').\n',
		);
	} catch (error) {
		process.stderr.write(
			'DIF-UX-WO-001: ' + (error instanceof Error ? error.message : String(error)) + '\n',
		);
		process.exitCode = 1;
	}
}
