import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alignScriptToAsr } from '#lib/domain/captions.js';

const enabled = Boolean(
	process.env.VOSK_MODEL &&
	process.env.VOSK_PYTHON &&
	process.env.PIPER_MODEL &&
	(process.env.PIPER_PYTHON || process.env.PIPER_BIN),
);
let workspace: string | null = null;

afterAll(async () => {
	if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!enabled)('real ASR caption alignment', () => {
	it('aligns a synthesized pt-BR voice to the known script', async () => {
		workspace = await mkdtemp(join(tmpdir(), 'dif-asr-caption-'));
		const source = join(workspace, 'source.txt');
		const audio = join(workspace, 'voice.wav');
		const text =
			'Às três e dezessete da manhã, a fita começou a tocar sozinha. Alice reconheceu a própria voz.';
		const { writeFile } = await import('node:fs/promises');
		await writeFile(source, `${text}\n`, 'utf8');
		const piper = process.env.PIPER_PYTHON;
		const args = piper
			? ['-m', 'piper', '-m', process.env.PIPER_MODEL!, '-i', source, '-f', audio]
			: ['-m', process.env.PIPER_MODEL!, '-f', audio];
		execFileSync(piper ?? process.env.PIPER_BIN!, args, {
			input: piper ? undefined : text,
			timeout: 180_000,
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		const stdout = execFileSync(
			process.env.VOSK_PYTHON!,
			[
				join(process.cwd(), 'scripts', 'asr-vosk.py'),
				'--input',
				audio,
				'--model',
				process.env.VOSK_MODEL!,
			],
			{ timeout: 300_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		);
		const parsed = JSON.parse(stdout) as {
			words: Array<{ word: string; startMs: number; endMs: number; confidence: number }>;
		};
		const aligned = alignScriptToAsr({
			segments: [
				{ index: 0, text: 'Às três e dezessete da manhã, a fita começou a tocar sozinha.' },
				{ index: 1, text: 'Alice reconheceu a própria voz.' },
			],
			asrWords: parsed.words,
			durationMs: 20_000,
		});
		expect(parsed.words.length).toBeGreaterThan(8);
		expect(aligned.source).toBe('FORCED_ALIGNMENT');
		expect(aligned.alignmentScore).toBeGreaterThan(0.5);
		expect(aligned.cues.map((cue) => cue.text).join(' ')).toContain('Alice reconheceu');
	}, 600_000);
});
