import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	// The video ingest and timeline journeys each saturate the disposable local
	// PostgREST/R2 pipeline; serial execution avoids artificial pool timeouts.
	workers: 1,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run dev -- --port 4173',
		url: 'http://127.0.0.1:4173/health',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? '',
			PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
			PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
			SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
			SUPABASE_OWNER_USER_ID: process.env.SUPABASE_OWNER_USER_ID ?? '',
			APP_ORIGIN: 'http://127.0.0.1:4173',
			CLOUDINARY_CLOUD_NAME: '',
			CLOUDINARY_API_KEY: '',
			CLOUDINARY_API_SECRET: '',
			VIDEO_STORAGE_DRIVER: process.env.VIDEO_STORAGE_DRIVER ?? '',
			VIDEO_PROBE_DRIVER: process.env.VIDEO_PROBE_DRIVER ?? '',
			MAX_VIDEO_MB: process.env.MAX_VIDEO_MB ?? '',
			VIDEO_PART_SIZE_MB: process.env.VIDEO_PART_SIZE_MB ?? '',
			R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? '',
			R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
			R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
			R2_BUCKET: process.env.R2_BUCKET ?? '',
			R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
			E2E_OWNER_EMAIL: process.env.E2E_OWNER_EMAIL ?? '',
			E2E_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD ?? '',
			E2E_OTHER_EMAIL: process.env.E2E_OTHER_EMAIL ?? '',
			E2E_OTHER_PASSWORD: process.env.E2E_OTHER_PASSWORD ?? '',
		},
	},
});
