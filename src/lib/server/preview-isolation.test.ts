import { describe, expect, it } from 'vitest';
import type { AppConfig } from './config.js';
import { isolatePreviewBackends } from './preview-isolation.js';

const configured = {
	supabaseUrl: 'https://example.supabase.co',
	supabasePublishableKey: 'publishable',
	supabaseServiceRoleKey: 'service-role',
	ownerUserId: '11111111-1111-4111-8111-111111111111',
	appOrigin: 'https://dif-studio.example',
	cloudinaryCloudName: 'cloud',
	cloudinaryApiKey: 'key',
	cloudinaryApiSecret: 'secret',
	maxUploadBytes: 10_485_760,
	supabaseConfigured: true,
	supabaseAdminConfigured: true,
	ownerConfigured: true,
	cloudinaryConfigured: true,
	r2AccountId: 'account',
	r2AccessKeyId: 'access',
	r2SecretAccessKey: 'secret',
	r2Bucket: 'bucket',
	r2Endpoint: 'https://r2.example',
	r2Configured: true,
	videoStorageDriver: 'r2',
	videoProbeDriver: 'ffprobe',
	maxVideoBytes: 200 * 1024 * 1024,
	videoPartBytes: 8 * 1024 * 1024,
} satisfies AppConfig;

describe('isolatePreviewBackends', () => {
	it('keeps production and local configuration unchanged', () => {
		expect(isolatePreviewBackends(configured, 'production')).toBe(configured);
		expect(isolatePreviewBackends(configured, undefined)).toBe(configured);
	});

	it('fails closed on Vercel Preview even when production env vars are present', () => {
		const preview = isolatePreviewBackends(configured, 'preview');
		expect(preview.supabaseUrl).toBeUndefined();
		expect(preview.supabasePublishableKey).toBeUndefined();
		expect(preview.supabaseServiceRoleKey).toBeUndefined();
		expect(preview.ownerUserId).toBeUndefined();
		expect(preview.supabaseConfigured).toBe(false);
		expect(preview.supabaseAdminConfigured).toBe(false);
		expect(preview.ownerConfigured).toBe(false);
		expect(preview.cloudinaryConfigured).toBe(false);
		expect(preview.r2Configured).toBe(false);
		expect(preview.cloudinaryApiSecret).toBeUndefined();
		expect(preview.r2SecretAccessKey).toBeUndefined();
	});

	it('preserves non-secret limits for preview UI rendering', () => {
		const preview = isolatePreviewBackends(configured, 'preview');
		expect(preview.appOrigin).toBe(configured.appOrigin);
		expect(preview.maxUploadBytes).toBe(configured.maxUploadBytes);
		expect(preview.maxVideoBytes).toBe(configured.maxVideoBytes);
		expect(preview.videoPartBytes).toBe(configured.videoPartBytes);
	});
});
