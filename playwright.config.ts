import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
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
			SUPABASE_OWNER_USER_ID: process.env.SUPABASE_OWNER_USER_ID ?? '',
			APP_ORIGIN: 'http://127.0.0.1:4173',
			CLOUDINARY_CLOUD_NAME: '',
			CLOUDINARY_API_KEY: '',
			CLOUDINARY_API_SECRET: '',
			E2E_OWNER_EMAIL: process.env.E2E_OWNER_EMAIL ?? '',
			E2E_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD ?? '',
			E2E_OTHER_EMAIL: process.env.E2E_OTHER_EMAIL ?? '',
			E2E_OTHER_PASSWORD: process.env.E2E_OTHER_PASSWORD ?? '',
		},
	},
});
