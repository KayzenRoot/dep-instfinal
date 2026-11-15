import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAudioMixCommand } from '../src/lib/domain/render-composition.js';

function ffmpeg(args: string[]): void {
	execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
		timeout: 300_000,
		windowsHide: true,
	});
}

const workspace = await mkdtemp(join(tmpdir(), 'dif-audio-mix-bench-'));
try {
	const video = join(workspace, 'video.mp4');
	const voice = join(workspace, 'voice.wav');
	const music = join(workspace, 'music.wav');
	const impact = join(workspace, 'impact.wav');
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		'color=c=black:s=1080x1920:r=30:d=120',
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-pix_fmt',
		'yuv420p',
		video,
	]);
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=300:sample_rate=48000:duration=100',
		'-ac',
		'1',
		'-c:a',
		'pcm_s16le',
		voice,
	]);
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=90:sample_rate=48000:duration=120',
		'-ac',
		'1',
		'-c:a',
		'pcm_s16le',
		music,
	]);
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		'sine=frequency=1200:sample_rate=48000:duration=2',
		'-ac',
		'1',
		'-c:a',
		'pcm_s16le',
		impact,
	]);
	const command = buildAudioMixCommand({
		videoPath: video,
		outputPath: join(workspace, 'mix.mp4'),
		videoDurationMs: 120_000,
		narration: { path: voice, durationMs: 100_000 },
		events: [
			{
				id: 'music',
				path: music,
				kind: 'MUSIC',
				startMs: 0,
				durationMs: 120_000,
				sourceInMs: 0,
				gainDb: -20,
				fadeInMs: 1_500,
				fadeOutMs: 3_000,
				pan: 0,
				distance: 0.8,
				loop: true,
				ducking: true,
				spatialPreset: 'corridor',
				spatialMode: 'binaural_simulated',
				intensity: 3,
			},
			{
				id: 'impact',
				path: impact,
				kind: 'SFX',
				startMs: 105_000,
				durationMs: 2_000,
				sourceInMs: 0,
				gainDb: -4,
				fadeInMs: 50,
				fadeOutMs: 300,
				pan: 0,
				distance: 0.2,
				loop: false,
				ducking: false,
				spatialPreset: 'steps-behind',
				spatialMode: 'binaural_simulated',
				intensity: 5,
			},
		],
	});
	const args = command.args.map((argument) => (argument === 'error' ? 'info' : argument));
	args.splice(args.indexOf('-hide_banner') + 1, 0, '-benchmark');
	const started = Date.now();
	const timeFile = process.env.BENCH_TIME_FILE;
	const result = timeFile
		? spawnSync('/usr/bin/time', ['-v', '-o', timeFile, 'ffmpeg', '-nostdin', ...args], {
				encoding: 'utf8',
			})
		: spawnSync('ffmpeg', ['-nostdin', ...args], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr.slice(0, 2_000));
	const bench = /bench:\s*utime=([0-9.]+)s\s*stime=([0-9.]+)s\s*rtime=([0-9.]+)s/.exec(
		result.stderr,
	);
	const rss = /bench:\s*maxrss=([0-9]+)KiB/.exec(result.stderr);
	let timeRss: number | null = null;
	if (timeFile) {
		try {
			const timeOutput = await readFile(timeFile, 'utf8');
			const match = /Maximum resident set size \(kbytes\):\s*([0-9]+)/.exec(timeOutput);
			timeRss = match ? Number(match[1]) : null;
		} catch {
			timeRss = null;
		}
	}
	process.stdout.write(
		`${JSON.stringify({
			videoDurationMs: 120_000,
			eventCount: command.eventCount,
			duckedCount: command.duckedCount,
			wallMs: Date.now() - started,
			utimeSeconds: bench ? Number(bench[1]) : null,
			stimeSeconds: bench ? Number(bench[2]) : null,
			rtimeSeconds: bench ? Number(bench[3]) : null,
			maxRssKiB: timeRss ?? (rss ? Number(rss[1]) : null),
		})}\n`,
	);
} finally {
	await rm(workspace, { recursive: true, force: true });
}
