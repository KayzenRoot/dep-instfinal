import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			preprocess: vitePreprocess(),
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['none'],
					'form-action': ['self'],
					'img-src': ['self', 'data:', 'blob:', 'https://res.cloudinary.com'],
					'font-src': ['self', 'data:'],
					'style-src': ['self'],
					'style-src-attr': ['unsafe-inline'],
					'script-src': ['self'],
					'connect-src': ['self', 'https://*.supabase.co', 'https://api.cloudinary.com'],
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
