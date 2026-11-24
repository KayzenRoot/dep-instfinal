import { describe, expect, it } from 'vitest';
import type { AppConfig } from './config.js';
import { isolatePreviewBackends } from './preview-isolation.js';

const baseConfig: AppConfig = {
	supabaseUrl: 'https://production.example',
	supabasePublishableKey: 'public-test-key',
	supabaseServiceRoleKey: 'admin-test-key',
	ownerUserId: '00000000-0000-4000-8000-000000000001',
	appOrigin: 'https://preview.example',
	cloudinaryCloudName: 'test-cloud',
	cloudinaryApiKey: 'test-public',
	cloudinaryApiSecret: 'test-secret',
	maxUploadBytes: 10_485_760,
	supabaseConfigured: true,
	supabaseAdminConfigured: true,
	ownerConfigured: true,
	cloudinaryConfigured: true,
	r2AccountId: 'test-account',
	r2AccessKeyId: 'test-access',
	r2SecretAccessKey: 'test-r2-secret',
	r2Bucket: 'test-bucket',
	r2Endpoint: 'https://storage.example',
	r2Configured: true,
	videoStorageDriver: 'r2',
	videoProbeDriver: 'none',
	maxVideoBytes: 209_715_200,
	videoPartBytes: 8_388_608,
};

describe('Vercel Preview isolation', () => {
	it('fails closed for every external data and privileged integration', () => {
		const isolated = isolatePreviewBackends(baseConfig, 'preview');
		expect(isolated).toMatchObject({
			supabaseConfigured: false,
			supabaseAdminConfigured: false,
			ownerConfigured: false,
			cloudinaryConfigured: false,
			r2Configured: false,
		});
		for (const key of [
			'supabaseUrl',
			'supabasePublishableKey',
			'supabaseServiceRoleKey',
			'ownerUserId',
			'cloudinaryCloudName',
			'cloudinaryApiKey',
			'cloudinaryApiSecret',
			'r2AccountId',
			'r2AccessKeyId',
			'r2SecretAccessKey',
			'r2Bucket',
			'r2Endpoint',
		] as const) {
			expect(isolated[key]).toBeUndefined();
		}
	});

	it('preserves non-secret origin, quotas and display/runtime settings in Preview', () => {
		const isolated = isolatePreviewBackends(baseConfig, 'preview');
		expect(isolated.appOrigin).toBe(baseConfig.appOrigin);
		expect(isolated.maxVideoBytes).toBe(baseConfig.maxVideoBytes);
		expect(isolated.videoStorageDriver).toBe(baseConfig.videoStorageDriver);
		expect(isolated).not.toBe(baseConfig);
	});

	it('does not change Production or local development', () => {
		expect(isolatePreviewBackends(baseConfig, 'production')).toBe(baseConfig);
		expect(isolatePreviewBackends(baseConfig, 'development')).toBe(baseConfig);
		expect(isolatePreviewBackends(baseConfig, undefined)).toBe(baseConfig);
	});
});
