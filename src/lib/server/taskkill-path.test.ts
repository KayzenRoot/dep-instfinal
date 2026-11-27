import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTaskkillPath } from '../../../scripts/taskkill-path.mjs';

describe('resolveTaskkillPath', () => {
	it('uses the fixed System32 directory under SystemRoot', () => {
		const result = resolveTaskkillPath({ SystemRoot: 'C:\\Windows' });
		expect(result).toBe(win32.join('C:\\Windows', 'System32', 'taskkill.exe'));
		expect(win32.isAbsolute(result)).toBe(true);
	});

	it('does not search PATH or accept a relative override', () => {
		const result = resolveTaskkillPath({ SystemRoot: 'D:\\WinRoot', PATH: 'C:\\writable' });
		expect(result).toContain('System32');
		expect(result.startsWith('D:\\WinRoot')).toBe(true);
		expect(result).not.toContain('writable');
	});

	it('rejects a missing SystemRoot instead of falling back to a PATH binary', () => {
		expect(() => resolveTaskkillPath({})).toThrow(/SystemRoot/);
	});

	it('rejects relative and user-writable SystemRoot values', () => {
		for (const root of ['Windows', 'C:\\Users\\owner', '\\\\server\\share\\Windows']) {
			expect(() => resolveTaskkillPath({ SystemRoot: root })).toThrow(/SystemRoot/);
		}
	});
});
