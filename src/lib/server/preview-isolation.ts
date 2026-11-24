import type { AppConfig } from './config.js';

/**
 * Production-connected credentials must never be used by Vercel Preview.
 * Previews remain fail-closed until a separate, approved test backend is provisioned.
 */
export function isolatePreviewBackends(
	config: AppConfig,
	vercelEnvironment: string | undefined,
): AppConfig {
	if (vercelEnvironment !== 'preview') return config;

	return {
		...config,
		supabaseUrl: undefined,
		supabasePublishableKey: undefined,
		supabaseServiceRoleKey: undefined,
		ownerUserId: undefined,
		supabaseConfigured: false,
		supabaseAdminConfigured: false,
		ownerConfigured: false,
		cloudinaryCloudName: undefined,
		cloudinaryApiKey: undefined,
		cloudinaryApiSecret: undefined,
		cloudinaryConfigured: false,
		r2AccountId: undefined,
		r2AccessKeyId: undefined,
		r2SecretAccessKey: undefined,
		r2Bucket: undefined,
		r2Endpoint: undefined,
		r2Configured: false,
	};
}
