import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTaskkillPath } from './taskkill-path.mjs';

test('resolves a protected system executable without relying on PATH', () => {
	assert.equal(
		resolveTaskkillPath({ SystemRoot: 'C:\\Windows', PATH: 'C:\\untrusted' }),
		'C:\\Windows\\System32\\taskkill.exe',
	);
});

test('supports an alternate local Windows drive', () => {
	assert.equal(resolveTaskkillPath({ SystemRoot: 'D:\\Windows' }), 'D:\\Windows\\System32\\taskkill.exe');
});

test('rejects relative, UNC and user-writable directories', () => {
	for (const root of ['Windows', '\\\\server\\share\\Windows', 'C:\\Users\\owner']) {
		assert.throws(() => resolveTaskkillPath({ SystemRoot: root }), /SystemRoot/);
	}
});

test('does not fall back to an untrusted PATH', () => {
	assert.throws(() => resolveTaskkillPath({ PATH: 'C:\\untrusted' }), /SystemRoot/);
});
