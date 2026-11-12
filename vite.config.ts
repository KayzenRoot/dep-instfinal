import { sveltekit } from '@sveltejs/kit/vite';
import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import tailwindcss from '@tailwindcss/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: process.env.VERCEL ? vercelAdapter({ runtime: 'nodejs24.x' }) : nodeAdapter(),
			preprocess: vitePreprocess(),
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['none'],
					'form-action': ['self'],
					'img-src': [
						'self',
						'data:',
						'blob:',
						'https://res.cloudinary.com',
						'https://*.r2.cloudflarestorage.com',
					],
					'font-src': ['self', 'data:'],
					'style-src': ['self'],
					'style-src-attr': ['unsafe-inline'],
					'script-src': ['self'],
					'connect-src': [
						'self',
						'https://*.supabase.co',
						'https://api.cloudinary.com',
						'https://*.r2.cloudflarestorage.com',
					],
					'media-src': ['self', 'https://*.r2.cloudflarestorage.com'],
					'worker-src': ['self', 'blob:'],
					'manifest-src': ['self'],
				},
			},
		}),
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
		clearMocks: true,
	},
});
