<script lang="ts">
	import type { AspectPreset } from './ui-types';

	export let preset: AspectPreset = '9:16';
	export let title = 'PRÉVIA DE CAPA';
	export let detail = 'Rosto e texto ficam nesta área';

	$: ratio = preset === '4:5' ? '4 / 5' : preset === '3:4' ? '3 / 4' : '9 / 16';
</script>

<figure class="safe-zone-card">
	<div class="preview-frame" style:aspect-ratio={ratio}>
		<div class="preview-top">
			<span>ÁREA DE INTERFACE</span><span class="rec-dot" aria-hidden="true"></span>
		</div>
		<div class="preview-scene" aria-hidden="true">
			<span class="scene-halo"></span>
			<span class="scene-silhouette"></span>
			<span class="scene-grain"></span>
		</div>
		<div class="safe-boundary" aria-hidden="true">
			<span class="boundary-label">ÁREA SEGURA</span>
			<strong>{title}</strong>
			<small>{detail}</small>
		</div>
		<div class="preview-bottom"><span>COMENTÁRIOS / CTA</span><span>···</span></div>
	</div>
	<figcaption>
		<span>PRESET</span><strong>{preset}</strong><span class="caption-dim"
			>Prévia esquemática · sem imagem real</span
		>
	</figcaption>
</figure>

<style>
	.safe-zone-card {
		width: min(100%, 18rem);
		margin: 0;
	}

	.preview-frame {
		position: relative;
		width: 100%;
		min-height: 13rem;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: 0.8rem;
		background: #17191b;
		box-shadow: 0 18px 38px rgb(0 0 0 / 24%);
	}

	.preview-scene,
	.scene-grain {
		position: absolute;
		inset: 0;
	}

	.preview-scene {
		background:
			linear-gradient(180deg, rgb(6 7 8 / 18%), transparent 32%, rgb(6 7 8 / 82%)),
			radial-gradient(ellipse at 58% 45%, rgb(183 63 85 / 36%), transparent 32%),
			linear-gradient(135deg, #32302d 0%, #131518 44%, #090a0b 100%);
	}

	.scene-halo {
		position: absolute;
		top: 21%;
		left: 36%;
		width: 34%;
		aspect-ratio: 1;
		border: 1px solid rgb(217 208 187 / 18%);
		border-radius: 50%;
		box-shadow: 0 0 4rem rgb(183 63 85 / 11%);
	}

	.scene-silhouette {
		position: absolute;
		bottom: 12%;
		left: 43%;
		width: 22%;
		height: 43%;
		border-radius: 48% 48% 15% 15%;
		background: linear-gradient(90deg, #08090b, #17191a 48%, #070809);
		filter: blur(1px);
	}

	.scene-grain {
		background-image: repeating-linear-gradient(
			0deg,
			transparent 0 3px,
			rgb(255 255 255 / 3%) 4px,
			transparent 5px
		);
		mix-blend-mode: screen;
		opacity: 0.55;
	}

	.preview-top,
	.preview-bottom {
		position: absolute;
		right: 0.65rem;
		left: 0.65rem;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: rgb(240 236 229 / 72%);
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
	}

	.preview-top {
		top: 0.6rem;
	}
	.preview-bottom {
		bottom: 0.65rem;
	}

	.rec-dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--danger);
	}

	.safe-boundary {
		position: absolute;
		inset: 18% 13%;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		border: 1px dashed rgb(169 197 108 / 72%);
		text-align: center;
	}

	.boundary-label {
		margin-bottom: 0.55rem;
		color: var(--phosphor);
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.13em;
	}

	.safe-boundary strong {
		max-width: 95%;
		color: var(--ink);
		font-family: var(--display);
		font-size: clamp(1.2rem, 4vw, 1.8rem);
		font-weight: 500;
		line-height: 1;
		text-wrap: balance;
	}

	.safe-boundary small {
		max-width: 95%;
		margin-top: 0.55rem;
		color: rgb(240 236 229 / 78%);
		font-size: 0.6rem;
		line-height: 1.35;
	}

	figcaption {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding-top: 0.65rem;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.06em;
	}

	figcaption strong {
		color: var(--ink);
	}

	.caption-dim {
		margin-left: auto;
		color: var(--dim);
		font-family: var(--body);
		font-size: 0.62rem;
		letter-spacing: 0;
	}
</style>
