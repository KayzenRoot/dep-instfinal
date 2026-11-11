<script lang="ts">
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import SafeZonePreview from '#lib/components/SafeZonePreview.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data, form }: PageProps = $props();
	const readyAssets = $derived(data.assets.filter((asset) => asset.upload_status === 'READY'));
	let previewPreset = $state<'9:16' | '4:5' | '3:4'>('9:16');
	let previewAssetId = $state('');
	let compareAssetId = $state('');
	const previewAsset = $derived(readyAssets.find((asset) => asset.id === previewAssetId));
	const compareAsset = $derived(readyAssets.find((asset) => asset.id === compareAssetId));
	const previewAspect = $derived(
		previewPreset === '4:5' ? '4 / 5' : previewPreset === '3:4' ? '3 / 4' : '9 / 16',
	);
	$effect(() => {
		if (!previewAssetId && readyAssets[0]) previewAssetId = readyAssets[0].id;
		if (!compareAssetId && readyAssets[1]) compareAssetId = readyAssets[1].id;
	});
	const variantFor = (preset: '9:16' | '4:5' | '3:4') =>
		preset === '4:5' ? '4x5' : preset === '3:4' ? '3x4' : null;
	const previewSrc = (assetId: string) => {
		const variant = variantFor(previewPreset);
		return variant ? `/api/media/${assetId}?variant=${variant}` : `/api/media/${assetId}`;
	};
	const ratioWarning = (asset: { width?: number | null; height?: number | null } | undefined) => {
		if (!asset?.width || !asset?.height) return false;
		const target = previewPreset === '4:5' ? 4 / 5 : previewPreset === '3:4' ? 3 / 4 : 9 / 16;
		return Math.abs(asset.width / asset.height - target) > 0.08;
	};
</script>

<svelte:head><title>Biblioteca visual · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="MÍDIA PRIVADA"
	title="Biblioteca visual"
	description="Quadros originais ficam no Cloudinary autenticado. O banco guarda somente metadados e vínculos."
/>
{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
{#if form?.reconciled}<p class="form-success" role="status">
		Registro reconciliado com Cloudinary e imagem revalidada.
	</p>{:else if form?.reconciled === false}<p class="form-error" role="status">
		O ativo não foi encontrado no Cloudinary ou a consulta falhou. O estado foi preservado para nova
		conferência.
	</p>{/if}
{#if data.uploadState === 'success'}<p class="form-success" role="status">
		Imagem validada e armazenada com acesso autenticado.
	</p>{:else if data.uploadState === 'failed'}<p class="form-error" role="status">
		O upload não foi concluído. O registro de falha permanece para reconciliação.
	</p>{:else if data.uploadState === 'unavailable'}<p class="form-error" role="status">
		Configure Cloudinary no servidor antes de enviar quadros.
	</p>{/if}
<div class="library-grid">
	<Panel
		eyebrow="IMPORTAÇÃO"
		title="Adicionar quadro"
		description="PNG, JPEG ou WebP real · até 10 MB · 4096 × 4096 px · SVG bloqueado."
	>
		{#if !data.cloudinaryConfigured}<div class="setup-note">
				<strong>Cloudinary não configurado</strong>
				<p>
					A biblioteca continua listando metadados salvos, mas uploads e visualização privada ficam
					indisponíveis até informar credenciais server-only.
				</p>
			</div>{/if}
		<form class="form-stack" method="POST" action="/api/media/upload" enctype="multipart/form-data">
			<label
				>Tipo de quadro<select name="assetKind"
					><option value="FRAME">Cena / frame</option><option value="COVER">Capa</option><option
						value="REFERENCE">Referência visual</option
					></select
				></label
			>
			<label
				>Arquivo de imagem<input
					type="file"
					name="file"
					accept="image/png,image/jpeg,image/webp"
					required
					disabled={!data.cloudinaryConfigured}
				/></label
			>
			<label class="check-label"
				><input
					type="checkbox"
					name="rightsConfirmed"
					required
					disabled={!data.cloudinaryConfigured}
				/> Tenho direito de importar este arquivo.</label
			>
			<button class="primary-button" type="submit" disabled={!data.cloudinaryConfigured}
				>Validar e armazenar</button
			>
		</form>
	</Panel>
	<Panel
		eyebrow="SAFE ZONES"
		title="Guias de composição"
		description="Use as guias durante o enquadramento. O DIF Studio preserva o original e não cria crops silenciosamente."
	>
		<SafeZonePreview />
		<div class="ratio-list">
			<p><strong>Master vertical</strong><span>9:16 · 1080 × 1920</span></p>
			<p><strong>Feed quadrado alto</strong><span>4:5 · 1080 × 1350</span></p>
			<p><strong>Feed vertical</strong><span>3:4 · 1080 × 1440</span></p>
		</div>
	</Panel>
	<Panel
		eyebrow="PRÉVIA E CROP"
		title="Comparação lado a lado"
		description="Prévia privada derivada no servidor; o original permanece intacto."
	>
		<div class="preview-controls">
			<label
				>Enquadramento<select bind:value={previewPreset}>
					<option value="9:16">9:16 · master</option>
					<option value="4:5">4:5 · feed 1080×1350</option>
					<option value="3:4">3:4 · feed 1080×1440</option>
				</select></label
			>
			<label
				>Quadro A<select bind:value={previewAssetId}>
					<option value="">Selecione</option>
					{#each readyAssets as asset (asset.id)}
						<option value={asset.id}>{asset.asset_kind} · {asset.id.slice(0, 8)}</option>
					{/each}
				</select></label
			>
			<label
				>Quadro B<select bind:value={compareAssetId}>
					<option value="">Selecione</option>
					{#each readyAssets as asset (asset.id)}
						<option value={asset.id}>{asset.asset_kind} · {asset.id.slice(0, 8)}</option>
					{/each}
				</select></label
			>
		</div>
		{#if !previewAsset && !compareAsset}
			<p class="preview-empty">Nenhum quadro disponível. Envie imagens para pré-visualizar.</p>
		{:else}
			<div class="preview-pair">
				{#each [previewAsset, compareAsset] as asset, index (index)}
					{#if asset}
						<figure>
							<img
								src={previewSrc(asset.id)}
								alt={`Prévia ${index === 0 ? 'A' : 'B'} ${asset.id.slice(0, 8)}`}
								style={`aspect-ratio: ${previewAspect}`}
							/>
							<figcaption>
								{asset.width}×{asset.height} · {previewPreset}
								{#if ratioWarning(asset)}
									<span class="ratio-warning"
										>Proporção diferente do preset; confira as safe zones.</span
									>
								{/if}
							</figcaption>
						</figure>
					{/if}
				{/each}
			</div>
		{/if}
	</Panel>
</div>
<section class="asset-section" aria-labelledby="assets-title">
	<header class="asset-heading">
		<div>
			<p class="eyebrow">ARQUIVO</p>
			<h2 id="assets-title">{data.assets.length} registros · {readyAssets.length} disponíveis</h2>
		</div>
		<p>Originais nunca são sobrescritos.</p>
	</header>
	{#if data.assets.length}<div class="asset-grid">
			{#each data.assets as asset (asset.id)}<article class="asset-card">
					{#if asset.upload_status === 'READY'}<img
							src={`/api/media/${asset.id}`}
							alt={`${asset.asset_kind} ${asset.id.slice(0, 8)}`}
							loading="lazy"
						/>{:else}<div class="asset-placeholder" aria-hidden="true">
							{asset.upload_status === 'FAILED' || asset.upload_status === 'ORPHANED' ? '!' : '···'}
						</div>{/if}
					<div class="asset-meta">
						<div>
							<strong>{asset.asset_kind}</strong><StatusPill
								label={asset.upload_status}
								tone={asset.upload_status === 'READY'
									? 'phosphor'
									: asset.upload_status === 'FAILED' || asset.upload_status === 'ORPHANED'
										? 'danger'
										: 'neutral'}
							/>
						</div>
						<small
							>{asset.format?.toUpperCase() ?? 'FORMATO PENDENTE'} · {asset.width ?? '—'} × {asset.height ??
								'—'} · {asset.byte_size
								? `${(asset.byte_size / 1024 / 1024).toFixed(1)} MB`
								: 'aguardando'}</small
						>{#if asset.safe_error_code}<small class="error-code">{asset.safe_error_code}</small
							>{/if}<time datetime={asset.created_at}
							>{new Date(asset.created_at).toLocaleString('pt-BR')}</time
						>
						{#if data.cloudinaryConfigured && ['UPLOADING', 'FAILED', 'ORPHANED'].includes(asset.upload_status)}<form
								method="POST"
								action="?/reconcileAsset"
							>
								<input type="hidden" name="assetId" value={asset.id} />
								<button type="submit">Conferir com Cloudinary</button>
							</form>{/if}
					</div>
				</article>{/each}
		</div>{:else}<Panel
			eyebrow="SEM QUADROS"
			title="A biblioteca começa com imagens aprovadas pela autora."
			description="Envie quadros quando o Cloudinary autenticado estiver configurado."
		/>{/if}
</section>

<style>
	.library-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-items: start;
	}
	.form-stack {
		display: grid;
		gap: 0.7rem;
	}
	.form-stack label {
		display: grid;
		gap: 0.3rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.form-stack input,
	.form-stack select {
		width: 100%;
		padding: 0.6rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.form-stack input[type='file'] {
		font-size: 0.7rem;
	}
	.check-label {
		display: flex !important;
		align-items: center;
		gap: 0.5rem !important;
	}
	.check-label input {
		width: auto !important;
		accent-color: var(--phosphor);
	}
	.primary-button {
		min-height: 2.6rem;
		padding: 0.55rem 0.8rem;
		border: 1px solid rgb(169 197 108 / 48%);
		border-radius: var(--radius-sm);
		background: linear-gradient(145deg, #a9c56c, #7f9c4a);
		color: #10130b;
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.setup-note {
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #0b0d10;
	}
	.setup-note strong {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.setup-note p {
		margin: 0.35rem 0 0;
		color: var(--muted);
		font-size: 0.69rem;
	}
	.ratio-list {
		display: grid;
		gap: 0.3rem;
		margin-top: 1rem;
	}
	.ratio-list p {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		margin: 0;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--line);
		font-size: 0.7rem;
	}
	.ratio-list span {
		color: var(--muted);
		font-family: var(--mono);
	}
	.asset-section {
		margin-top: 2.5rem;
	}
	.asset-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.asset-heading h2 {
		margin: 0;
	}
	.asset-heading > p {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.asset-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.8rem;
	}
	.asset-card {
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--panel);
	}
	.asset-card img,
	.asset-placeholder {
		width: 100%;
		aspect-ratio: 3/4;
		object-fit: cover;
		background: #0b0d10;
	}
	.asset-placeholder {
		display: grid;
		place-items: center;
		color: var(--danger);
		font: 2rem var(--mono);
	}
	.asset-meta {
		display: grid;
		gap: 0.35rem;
		padding: 0.7rem;
	}
	.asset-meta > div {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.asset-meta strong {
		font-size: 0.68rem;
	}
	.asset-meta small,
	.asset-meta time {
		color: var(--muted);
		font-size: 0.58rem;
		overflow-wrap: anywhere;
	}
	.asset-meta .error-code {
		color: #ed9aaa;
		font-family: var(--mono);
	}
	.asset-meta form button {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
		font-size: 0.68rem;
		cursor: pointer;
	}
	.form-error,
	.form-success {
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
	}
	.form-error {
		color: #ed9aaa;
	}
	.form-success {
		color: var(--phosphor);
	}
	.preview-controls {
		display: grid;
		gap: 0.6rem;
	}
	.preview-pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		margin-top: 0.7rem;
	}
	.preview-pair figure {
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	.preview-pair img {
		width: 100%;
		aspect-ratio: 9 / 16;
		object-fit: cover;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #000;
	}
	.preview-pair figcaption {
		color: var(--muted);
		font-size: 0.7rem;
		display: grid;
		gap: 0.2rem;
	}
	.ratio-warning {
		color: #ed9aaa;
		font-family: var(--mono);
	}
	.preview-empty {
		color: var(--muted);
		font-size: 0.78rem;
	}
	@media (max-width: 950px) {
		.asset-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.library-grid {
			grid-template-columns: 1fr;
		}
		.asset-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
