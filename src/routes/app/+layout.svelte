<script lang="ts">
	import type { LayoutProps } from './$types';
	import AppShell from '#lib/components/AppShell.svelte';
	let { data, children }: LayoutProps = $props();
</script>

<AppShell currentPath={data.currentPath} ownerLabel={data.ownerLabel}>{@render children()}</AppShell
>
