<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { AUDIO_CATEGORY_PRESETS } from '#lib/schemas/audio-library.js';

	let {
		data,
		form,
	}: {
		data: PageData;
		form: {
			success?: boolean;
			message?: string;
			assetId?: string;
			title?: string;
			licenseUpdated?: boolean;
		} | null;
	} = $props();

	const kindLabels = { AMBIENCE: 'Ambiência', MUSIC: 'Música', SFX: 'Efeito' } as const;
	const statusLabels = {
		VERIFIED: 'Verificada',
		UNKNOWN: 'Desconhecida',
		BLOCKED: 'Bloqueada',
	} as const;

	function filterHref(params: Record<string, string>): string {
		const base = resolve('/app/audio');
		const query = new URLSearchParams(params).toString();
		return query ? `${base}?${query}` : base;
	}
</script>

<svelte:head><title>Biblioteca de áudio | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">ÁUDIO</p>
	<h1>Biblioteca licenciada</h1>
	<p class="lede">
		Importe apenas sons com licença, autoria e atribuição registradas. Licença desconhecida ou sem
		direito comercial/social fica retida; nada é baixado automaticamente.
	</p>
</section>

{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
{#if form?.success}
	<p class="notice success" role="status">
		{form.licenseUpdated
			? 'Licença atualizada.'
			: `“${form.title}” importado. Já pode ser usado na timeline.`}
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

<section class="filters" aria-label="Filtros da biblioteca">
	<a href={resolve('/app/audio')} class:active={!data.filter.kind && !data.filter.tag}>Todos</a>
	{#each Object.entries(kindLabels) as [kind, label] (kind)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={filterHref({ kind })} class:active={data.filter.kind === kind}>{label}</a>
	{/each}
	{#each AUDIO_CATEGORY_PRESETS as tag (tag)}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={filterHref({ tag })} class:active={data.filter.tag === tag}>{tag}</a>
	{/each}
</section>

<section class="library">
	<h2>Acervo</h2>
	{#if !data.assets.length}
		<p class="empty">Nenhum áudio neste filtro. Importe o primeiro com licença documentada.</p>
	{:else}
		<ul class="asset-list">
			{#each data.assets as asset (asset.id)}
				<li>
					<header>
						<div>
							<p class="kicker">{kindLabels[asset.kind]} · intensidade {asset.intensity}</p>
							<h3>{asset.title}</h3>
							<p class="meta">{asset.author} · {asset.source}</p>
						</div>
						<span class="badge" class:blocked={asset.licenseStatus !== 'VERIFIED'}>
							{statusLabels[asset.licenseStatus]}
						</span>
					</header>
					<p class="license">
						{asset.licenseName}
						{#if asset.licenseUrl}
							· <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a href={asset.licenseUrl} rel="noreferrer">licença</a>
						{/if}
						· atribuição: {asset.attribution}
					</p>
					<p class="meta">
						{asset.durationMs} ms · {asset.channels === 1 ? 'mono' : 'estéreo'} ·
						{asset.sampleRate} Hz · {asset.format}
					</p>
					<p class="tags">
						{#each [...new Set(asset.tags)] as tag (tag)}<span>{tag}</span>{/each}
					</p>
					<audio
						controls
						preload="none"
						src={resolve('/api/audio/[assetId]', { assetId: asset.id })}
					></audio>
					<form method="POST" action="?/license" class="license-form">
						<input type="hidden" name="assetId" value={asset.id} />
						<label
							>Status
							<select name="licenseStatus">
								<option value="UNKNOWN" selected={asset.licenseStatus === 'UNKNOWN'}
									>Desconhecida</option
								>
								<option value="VERIFIED" selected={asset.licenseStatus === 'VERIFIED'}
									>Verificada</option
								>
								<option value="BLOCKED" selected={asset.licenseStatus === 'BLOCKED'}
									>Bloqueada</option
								>
							</select></label
						>
						<label class="check"
							><input type="checkbox" name="commercialAllowed" checked={asset.commercialAllowed} /> Comercial</label
						>
						<label class="check"
							><input type="checkbox" name="socialAllowed" checked={asset.socialAllowed} /> Social</label
						>
						<label class="wide"
							>Atribuição
							<input name="attribution" maxlength="300" value={asset.attribution} />
						</label>
						<button type="submit">Atualizar licença</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="upload">
	<h2>Importar áudio</h2>
	<form method="POST" action="?/upload" enctype="multipart/form-data" class="upload-form">
		<label>Arquivo <input type="file" name="file" accept=".wav,.mp3,.m4a,.ogg" required /></label>
		<label
			>Tipo
			<select name="kind" required>
				<option value="SFX">Efeito</option>
				<option value="AMBIENCE">Ambiência</option>
				<option value="MUSIC">Música</option>
			</select>
		</label>
		<label>Título <input name="title" maxlength="120" required /></label>
		<label>Autor <input name="author" maxlength="120" required /></label>
		<label>Origem <input name="source" maxlength="200" required /></label>
		<label>Licença <input name="licenseName" maxlength="120" required /></label>
		<label>URL da licença <input name="licenseUrl" type="url" maxlength="500" /></label>
		<label class="wide"
			>Atribuição <input
				name="attribution"
				maxlength="300"
				required
				placeholder="Texto exato de crédito"
			/>
		</label>
		<label
			>Status
			<select name="licenseStatus" required>
				<option value="UNKNOWN">Desconhecida</option>
				<option value="VERIFIED">Verificada</option>
				<option value="BLOCKED">Bloqueada</option>
			</select>
		</label>
		<label
			>Intensidade
			<select name="intensity">
				{#each [1, 2, 3, 4, 5] as value (value)}
					<option {value} selected={value === 3}>{value}</option>
				{/each}
			</select>
		</label>
		<label class="wide"
			>Tags separadas por vírgula
			<input name="tags" required placeholder="porta, impacto, susto" />
		</label>
		<label class="check"
			><input type="checkbox" name="commercialAllowed" /> Permite uso comercial</label
		>
		<label class="check"
			><input type="checkbox" name="socialAllowed" /> Permite distribuição social</label
		>
		<button class="primary" type="submit">Importar com licença</button>
	</form>
</section>

<style>
	.page-head {
		display: grid;
		gap: 0.5rem;
		margin-block-end: 1.5rem;
	}
	.eyebrow {
		color: var(--accent);
		font-size: 0.75rem;
		letter-spacing: 0.18em;
	}
	h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
	}
	.lede,
	.meta,
	.license,
	.empty {
		color: var(--muted);
	}
	.lede {
		max-width: 70ch;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-block: 1rem;
	}
	.filters a {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.3rem 0.7rem;
		color: var(--muted);
		text-decoration: none;
	}
	.filters a.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.asset-list {
		display: grid;
		gap: 0.75rem;
		padding: 0;
		list-style: none;
	}
	.asset-list li {
		display: grid;
		gap: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface);
	}
	.asset-list header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	.asset-list h3 {
		font-size: 1.05rem;
	}
	.kicker {
		color: var(--accent);
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.badge {
		border: 1px solid var(--accent);
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		color: var(--accent);
		font-size: 0.75rem;
	}
	.badge.blocked {
		border-color: #d55;
		color: #ffb4b4;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.tags span {
		border: 1px solid var(--line);
		border-radius: 0.35rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.75rem;
	}
	audio {
		width: 100%;
	}
	.license-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		align-items: end;
		border-block-start: 1px solid var(--line);
		padding-block-start: 0.65rem;
	}
	.license-form label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.78rem;
	}
	.license-form .check {
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		align-items: center;
	}
	.license-form .wide {
		grid-column: 1 / -1;
	}
	.upload {
		margin-block-start: 2rem;
	}
	.upload-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		align-items: end;
	}
	.upload-form label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.82rem;
	}
	.upload-form .wide {
		grid-column: 1 / -1;
	}
	.upload-form .check {
		display: flex;
		gap: 0.45rem;
		align-items: center;
	}
	input,
	select {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.55rem 0.7rem;
	}
	button {
		cursor: pointer;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: var(--surface-strong, #222);
		color: var(--ink);
		padding: 0.55rem 0.8rem;
	}
	button.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: #0b0b0b;
		font-weight: 700;
	}
	.notice {
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin-block: 0.75rem;
	}
	.notice.error {
		border: 1px solid #d55;
		color: #ffb4b4;
		background: #2a1212;
	}
	.notice.success {
		border: 1px solid #5a5;
		color: #b8f5c0;
		background: #102a16;
	}
</style>
