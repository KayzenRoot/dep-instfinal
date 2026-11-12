<script lang="ts">
	import type { GlyphName } from './glyph';

	export let name: GlyphName;
</script>

<svg
	aria-hidden="true"
	viewBox="0 0 24 24"
	width="18"
	height="18"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#if name === 'archive'}
		<path d="M4 5.5h16v14H4z" />
		<path d="M3 3.5h18v2H3zM8 9h8M8 12h8M8 15h5" />
	{:else if name === 'book'}
		<path d="M5 4.5h12a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" />
		<path d="M5 17.5a2 2 0 0 1 2-2h12M9 8h6M9 11h6" />
	{:else if name === 'film'}
		<rect x="4" y="4.5" width="16" height="15" rx="2" />
		<path d="M8 4.5v15M16 4.5v15M4 9h4M16 9h4M4 15h4M16 15h4" />
	{:else if name === 'frames'}
		<rect x="5" y="5" width="13" height="13" rx="1.5" />
		<path d="M8 2.5h13.5V16M8 9l2.5-2.5 2.2 2.2 1.5-1.2L18 12" />
	{:else if name === 'library'}
		<path d="M4 6h16v14H4zM7 3h16v14" />
		<path d="M7.5 10h9M7.5 13h6" />
	{:else if name === 'branch'}
		<circle cx="6" cy="5" r="2" />
		<circle cx="18" cy="19" r="2" />
		<circle cx="18" cy="5" r="2" />
		<path d="M6 7v9a3 3 0 0 0 3 3h7M8 5h8" />
	{:else if name === 'export'}
		<path d="M12 3.5v11M8 10.5l4 4 4-4" />
		<path d="M5 16v4h14v-4" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-2.6v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.5-1H6.4v-2.6h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.1h2.6v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1V14h-.1a1.7 1.7 0 0 0-1.5 1Z"
		/>
	{:else if name === 'menu'}
		<path d="M4 6h16M4 12h16M4 18h16" />
	{:else}
		<path d="m6 6 12 12M18 6 6 18" />
	{/if}
</svg>
