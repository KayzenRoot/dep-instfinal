import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { verifyImages } from './verify-images.mjs';

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
const created = [];
afterEach(() => {
	for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
	const base = mkdtempSync(join(tmpdir(), 'dif-ux-'));
	created.push(base);
	mkdirSync(join(base, 'screens'));
	const images = ids.map((name, index) => {
		const png = Buffer.alloc(32);
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
		png.write('IHDR', 12, 'ascii');
		png.writeUInt32BE(1672, 16);
		png.writeUInt32BE(941, 20);
		png.writeUInt32BE(index + 1, 24);
		writeFileSync(join(base, 'screens', name + '.png'), png);
		return {
			name,
			file: 'screens/' + name + '.png',
			sha256: createHash('sha256').update(png).digest('hex'),
			exists_in_repo: true,
		};
	});
	const manifest = { name: 'DIF Studio Neon Glass', image_size: { width: 1672, height: 941 }, images };
	const path = join(base, 'manifest.json');
	const save = () => writeFileSync(path, JSON.stringify(manifest));
	save();
	return { base, manifest, path, save };
}

test('checks all nine independent image references', () => {
	const { path } = fixture();
	assert.deepEqual(verifyImages({ manifestPath: path }), {
		verified: 9,
		total: 9,
		mode: 'repository',
	});
});

test('fails closed on corrupted image content', () => {
	const { base, path } = fixture();
	const file = join(base, 'screens', '05-editor.png');
	const data = readFileSync(file);
	data[28] = 1;
	writeFileSync(file, data);
	assert.throws(() => verifyImages({ manifestPath: path }), /Hash divergente/);
});

test('fails closed if a required screen is absent', () => {
	const { base, path } = fixture();
	rmSync(join(base, 'screens', '04-episodes.png'));
	assert.throws(() => verifyImages({ manifestPath: path }), /ENOENT/);
});

test('manifest-only does not claim binary verification', () => {
	const { path, manifest, save } = fixture();
	for (const image of manifest.images) image.exists_in_repo = false;
	save();
	assert.deepEqual(verifyImages({ manifestPath: path, manifestOnly: true }), {
		verified: 0,
		total: 9,
		mode: 'manifest-only',
	});
	assert.throws(() => verifyImages({ manifestPath: path }), /Arquivo não promovido/);
});

test('rejects missing or duplicate screen names', () => {
	const { path, manifest, save } = fixture();
	manifest.images[3].name = '01-login';
	save();
	assert.throws(() => verifyImages({ manifestPath: path, manifestOnly: true }), /IDs ou ordem/);
});
