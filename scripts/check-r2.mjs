#!/usr/bin/env node
// Verifies a private R2 bucket with S3 credentials from a git-ignored env file.
// Usage: R2_ENV_FILE=/path/to/r2.env node scripts/check-r2.mjs
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';

const defaultEnvFile = 'C:/Users/csn19/.zcode/dif-secrets/r2.env';
const envFile = process.env.R2_ENV_FILE ?? defaultEnvFile;

function parseEnv(text) {
	return Object.fromEntries(
		text
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
			.filter(Boolean)
			.map(([, key, value]) => [key, value]),
	);
}

let env;
try {
	env = parseEnv(await readFile(envFile, 'utf8'));
} catch {
	console.error(`R2 env file not found: ${envFile}`);
	console.error(
		'Create a bucket-scoped R2 token and save R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_ENDPOINT there.',
	);
	process.exit(1);
}

for (const key of [
	'R2_ACCOUNT_ID',
	'R2_ACCESS_KEY_ID',
	'R2_SECRET_ACCESS_KEY',
	'R2_BUCKET',
	'R2_ENDPOINT',
]) {
	if (!env[key]) {
		console.error(`Missing ${key} in ${envFile}`);
		process.exit(1);
	}
}

const client = new S3Client({
	region: 'auto',
	endpoint: env.R2_ENDPOINT,
	forcePathStyle: true,
	credentials: {
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	},
});
const bucket = env.R2_BUCKET;
const key = `healthchecks/wo003-${Date.now()}.txt`;
const body = `dif-studio-r2-check ${new Date().toISOString()}\n`;

try {
	await client.send(new HeadBucketCommand({ Bucket: bucket }));
	console.log(`PASS head bucket ${bucket}`);
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: 'text/plain',
		}),
	);
	console.log(`PASS put object (${Buffer.byteLength(body)} bytes)`);
	const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	if (!object.Body) throw new Error('GetObject returned no body');
	const received = await object.Body.transformToString();
	if (received !== body) throw new Error('Object round-trip mismatch');
	console.log('PASS get object round-trip');
	await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
	console.log('PASS delete test object');
} catch (error) {
	console.error('FAIL R2 check:', error instanceof Error ? error.message : 'unknown error');
	process.exitCode = 1;
}
