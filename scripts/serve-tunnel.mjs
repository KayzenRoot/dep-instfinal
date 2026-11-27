import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function resolveCloudflaredCommand() {
	const configured = process.env.CLOUDFLARED_BIN?.trim();
	if (configured) {
		if (!isAbsolute(configured)) throw new Error('CLOUDFLARED_BIN must be an absolute path.');
		return configured;
	}
	const candidates = [
		'/usr/local/bin/cloudflared',
		'/usr/bin/cloudflared',
		'/opt/homebrew/bin/cloudflared',
		join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cloudflared.exe'),
	];
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error('CLOUDFLARED_BIN must point to the absolute cloudflared path.');
	return found;
}

const port = process.env.PORT ?? '3000';
const localUrl = `http://127.0.0.1:${port}`;

if (!existsSync('build')) {
	console.error('Production build not found. Run `npm run build` before `npm run serve:tunnel`.');
	process.exit(1);
}

const tunnel = spawn(
	resolveCloudflaredCommand(),
	['tunnel', '--url', localUrl, '--no-autoupdate'],
	{
		stdio: ['ignore', 'pipe', 'pipe'],
	},
);

let server;
let publicUrl;

function stop(exitCode = 0) {
	if (server && !server.killed) server.kill();
	if (!tunnel.killed) tunnel.kill();
	process.exit(exitCode);
}

function startServer(origin) {
	server = spawn(process.execPath, ['--env-file=.env', 'scripts/start.mjs'], {
		stdio: 'inherit',
		env: {
			...process.env,
			PORT: port,
			// Do not expose the Node SSR port directly to the LAN or internet.
			HOST: '127.0.0.1',
			APP_ORIGIN: origin,
			ORIGIN: origin,
			PROTOCOL_HEADER: 'x-forwarded-proto',
			HOST_HEADER: 'x-forwarded-host',
		},
	});
	server.on('exit', (code) => {
		console.error(`Production server exited with code ${code ?? 'unknown'}.`);
		stop(code ?? 1);
	});
}

async function waitForLocalHealth() {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			const response = await fetch(`${localUrl}/health`, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return true;
		} catch {
			// The server is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

function handleTunnelData(chunk) {
	const text = chunk.toString();
	process.stderr.write(text);
	const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
	if (!match || publicUrl) return;
	publicUrl = match[0];
	startServer(publicUrl);
	void waitForLocalHealth().then((healthy) => {
		if (!healthy) {
			console.error('Production server did not become healthy in time.');
			stop(1);
			return;
		}
		console.log(`\nDIF Studio public (temporary): ${publicUrl}`);
		console.log(
			'The URL changes whenever the tunnel restarts and requires this machine to stay online.',
		);
		console.log(
			'This quick tunnel has no Cloudflare Access; owner login remains required by the app.\n',
		);
	});
}

tunnel.stdout.on('data', handleTunnelData);
tunnel.stderr.on('data', handleTunnelData);

tunnel.on('error', (error) => {
	if (error.code === 'ENOENT') {
		console.error('cloudflared was not found on PATH. Install it and retry.');
		process.exit(1);
	}
	console.error(`Cloudflare tunnel failed: ${error.message}`);
	stop(1);
});

tunnel.on('exit', (code) => {
	if (!publicUrl) console.error(`Cloudflare tunnel exited with code ${code ?? 'unknown'}.`);
	stop(code ?? 1);
});

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
