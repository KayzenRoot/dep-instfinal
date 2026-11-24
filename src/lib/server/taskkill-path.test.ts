import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTaskkillPath } from '../../../scripts/taskkill-path.mjs';

describe('resolveTaskkillPath', () => {
	it('uses the fixed System32 directory under SystemRoot', () => {
		const result = resolveTaskkillPath({ SystemRoot: 'C:\\Windows' });
		expect(result).toBe(join('C:\\Windows', 'System32', 'taskkill.exe'));
		expect(isAbsolute(result)).toBe(true);
	});

	it('does not search PATH or accept a relative override', () => {
		const result = resolveTaskkillPath({ SystemRoot: 'D:\\WinRoot', PATH: 'C:\\writable' });
		expect(result).toContain('System32');
		expect(result.startsWith('D:\\WinRoot')).toBe(true);
		expect(result).not.toContain('writable');
	});

	it('falls back to the standard Windows directory', () => {
		expect(resolveTaskkillPath({})).toBe(join('C:\\Windows', 'System32', 'taskkill.exe'));
	});
});
