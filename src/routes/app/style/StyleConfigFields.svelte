<script lang="ts">
	import { untrack } from 'svelte';
	import { COLOR_PRESETS } from '#lib/domain/color-grade.js';
	import { DEFAULT_STYLE_CONFIG } from '#lib/domain/style-bible.js';
	import { COVER_TEMPLATE_LIST } from '#lib/domain/cover.js';
	import { END_CARD_TEMPLATE_LIST } from '#lib/domain/choice-end-card.js';
	import {
		STYLE_CAPTION_SAFE_ZONES,
		STYLE_CAPTION_TEMPLATES,
		STYLE_FONT_FAMILIES,
		STYLE_MOTION,
		STYLE_OPENING_HOOKS,
		STYLE_SFX_CATEGORIES,
		STYLE_VOICE_STYLES,
		type StyleConfig,
		type StyleOverride,
	} from '#lib/schemas/style-bible.js';

	interface Props {
		mode: 'full' | 'override' | 'scene';
		action: string;
		scopeType: string;
		scopeId: string;
		episodeId?: string;
		sceneId?: string;
		presetName?: string;
		expectedRevision?: number;
		config?: StyleConfig;
		override?: StyleOverride | null;
		submitLabel: string;
	}

	let {
		mode,
		action,
		scopeType,
		scopeId,
		episodeId = '',
		sceneId = '',
		presetName = '',
		expectedRevision = 0,
		config,
		override = null,
		submitLabel,
	}: Props = $props();

	let name = $state(untrack(() => presetName));
	let draft = $state({ ...(untrack(() => config) ?? DEFAULT_STYLE_CONFIG) });
	const existing = untrack(() => override);
	let strengthPct = $state(Math.round((untrack(() => config?.colorStrength ?? 1) as number) * 100));
	let sfxIds = $state((untrack(() => config?.sfxAssetIds) ?? []).join(', '));
	let overrideSfxIds = $state((existing?.sfxAssetIds ?? []).join(', '));
	const fontClass = $derived(`font-${draft.fontFamily}`);
	function selectValue(event: Event): string {
		return (event.target as HTMLSelectElement).value;
	}
</script>

{#if mode === 'full'}
	<form method="POST" {action} class="style-form">
		<input type="hidden" name="scopeType" value={scopeType} />
		<input type="hidden" name="scopeId" value={scopeId} />
		<input type="hidden" name="episodeId" value={episodeId} />
		<input type="hidden" name="expectedRevision" value={expectedRevision} />
		<label>
			Nome do preset
			<input name="name" maxlength="80" bind:value={name} required />
		</label>
		<div class="two">
			<label>
				Fundo
				<input type="color" name="paletteBackground" bind:value={draft.paletteBackground} />
			</label>
			<label>
				Texto
				<input type="color" name="paletteForeground" bind:value={draft.paletteForeground} />
			</label>
			<label>
				Accent
				<input type="color" name="paletteAccent" bind:value={draft.paletteAccent} />
			</label>
			<label>
				Secundário
				<input type="color" name="paletteMuted" bind:value={draft.paletteMuted} />
			</label>
		</div>
		<div class="two">
			<label>
				Color grade
				<select
					name="colorPresetId"
					value={draft.colorPresetId}
					onchange={(event) =>
						(draft.colorPresetId = selectValue(event) as StyleConfig['colorPresetId'])}
				>
					{#each Object.values(COLOR_PRESETS) as preset (preset.id)}
						<option value={preset.id}>{preset.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Força da cor ({strengthPct}%)
				<input type="range" name="colorStrength" min="0" max="100" bind:value={strengthPct} />
			</label>
		</div>
		<div class="two">
			<label>
				Tipografia
				<select
					name="fontFamily"
					value={draft.fontFamily}
					onchange={(event) => (draft.fontFamily = selectValue(event) as StyleConfig['fontFamily'])}
				>
					{#each STYLE_FONT_FAMILIES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Legenda
				<select
					name="captionTemplate"
					value={draft.captionTemplate}
					onchange={(event) =>
						(draft.captionTemplate = selectValue(event) as StyleConfig['captionTemplate'])}
				>
					{#each STYLE_CAPTION_TEMPLATES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Área segura
				<select
					name="captionSafeZone"
					value={draft.captionSafeZone}
					onchange={(event) =>
						(draft.captionSafeZone = selectValue(event) as StyleConfig['captionSafeZone'])}
				>
					{#each STYLE_CAPTION_SAFE_ZONES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="two">
			<label>
				Movimento
				<select
					name="motion"
					value={draft.motion}
					onchange={(event) => (draft.motion = selectValue(event) as StyleConfig['motion'])}
				>
					{#each STYLE_MOTION as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Intensidade VHS
				<select
					name="vhsIntensity"
					value={draft.vhsIntensity}
					onchange={(event) =>
						(draft.vhsIntensity = Number(selectValue(event)) as StyleConfig['vhsIntensity'])}
				>
					{#each [0, 1, 2, 3] as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<label class="check">
			<input type="checkbox" name="reducedMotion" bind:checked={draft.reducedMotion} />
			Reduzir movimento por padrão
		</label>
		<div class="two">
			<label>
				SFX
				<select
					name="sfxCategory"
					value={draft.sfxCategory}
					onchange={(event) =>
						(draft.sfxCategory = selectValue(event) as StyleConfig['sfxCategory'])}
				>
					{#each STYLE_SFX_CATEGORIES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				IDs de SFX (separados por vírgula)
				<input name="sfxAssetIds" bind:value={sfxIds} placeholder="uuid, uuid" />
			</label>
		</div>
		<div class="two">
			<label>
				Voz
				<select
					name="voiceStyle"
					value={draft.voiceStyle}
					onchange={(event) => (draft.voiceStyle = selectValue(event) as StyleConfig['voiceStyle'])}
				>
					{#each STYLE_VOICE_STYLES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Abertura
				<select
					name="openingHookKind"
					value={draft.openingHookKind}
					onchange={(event) =>
						(draft.openingHookKind = selectValue(event) as StyleConfig['openingHookKind'])}
				>
					{#each STYLE_OPENING_HOOKS as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="two">
			<label>
				Capa
				<select
					name="coverTemplateId"
					value={draft.coverTemplateId}
					onchange={(event) =>
						(draft.coverTemplateId = selectValue(event) as StyleConfig['coverTemplateId'])}
				>
					{#each COVER_TEMPLATE_LIST as template (template.id)}
						<option value={template.id}>{template.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Final A/B
				<select
					name="endCardTemplateId"
					value={draft.endCardTemplateId}
					onchange={(event) =>
						(draft.endCardTemplateId = selectValue(event) as StyleConfig['endCardTemplateId'])}
				>
					{#each END_CARD_TEMPLATE_LIST as template (template.id)}
						<option value={template.id}>{template.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<label>
			CTA
			<input name="ctaPrompt" maxlength="80" bind:value={draft.ctaPrompt} required />
		</label>
		<div
			class={`live-preview ${fontClass}`}
			style={`--bg:${draft.paletteBackground};--fg:${draft.paletteForeground};--accent:${draft.paletteAccent};--muted:${draft.paletteMuted}`}
		>
			<span class="pv-title">A casa não responde</span>
			<span class="pv-caption">{draft.ctaPrompt}</span>
			<span class="pv-meta">
				{draft.motion} · {draft.captionTemplate} · {draft.sfxCategory} · VHS {draft.vhsIntensity}
			</span>
		</div>
		<button type="submit">{submitLabel}</button>
	</form>
{:else}
	<form method="POST" {action} class="style-form">
		<input type="hidden" name="scopeType" value={scopeType} />
		<input type="hidden" name="scopeId" value={scopeId} />
		<input type="hidden" name="episodeId" value={episodeId} />
		{#if mode === 'scene'}<input type="hidden" name="sceneId" value={sceneId} />{/if}
		<p class="hint">
			Deixe um campo vazio para herdar da camada superior. Enviar todos os campos vazios remove o
			override e a camada volta a herdar integralmente.
		</p>
		<div class="two">
			<label>
				Fundo (herdar)
				<input
					name="paletteBackground"
					value={existing?.paletteBackground ?? ''}
					placeholder="#08090b"
				/>
			</label>
			<label>
				Texto (herdar)
				<input
					name="paletteForeground"
					value={existing?.paletteForeground ?? ''}
					placeholder="#e8e2d6"
				/>
			</label>
			<label>
				Accent (herdar)
				<input name="paletteAccent" value={existing?.paletteAccent ?? ''} placeholder="#b6ff9a" />
			</label>
			<label>
				Secundário (herdar)
				<input name="paletteMuted" value={existing?.paletteMuted ?? ''} placeholder="#8a8a8a" />
			</label>
		</div>
		<div class="two">
			<label>
				Color grade
				<select name="colorPresetId" value={existing?.colorPresetId ?? ''}>
					<option value="">herdar</option>
					{#each Object.values(COLOR_PRESETS) as preset (preset.id)}
						<option value={preset.id}>{preset.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Força da cor (0–100%, herdar)
				<input
					name="colorStrength"
					type="number"
					min="0"
					max="100"
					value={existing?.colorStrength != null ? Math.round(existing.colorStrength * 100) : ''}
				/>
			</label>
		</div>
		<div class="two">
			<label>
				Tipografia
				<select name="fontFamily" value={existing?.fontFamily ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_FONT_FAMILIES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Legenda
				<select name="captionTemplate" value={existing?.captionTemplate ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_CAPTION_TEMPLATES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Área segura
				<select name="captionSafeZone" value={existing?.captionSafeZone ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_CAPTION_SAFE_ZONES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="two">
			<label>
				Movimento
				<select name="motion" value={existing?.motion ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_MOTION as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Intensidade VHS (herdar)
				<select name="vhsIntensity" value={existing?.vhsIntensity ?? ''}>
					<option value="">herdar</option>
					{#each [0, 1, 2, 3] as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<label>
			Movimento reduzido
			<select
				name="reducedMotion"
				value={existing?.reducedMotion === true
					? 'true'
					: existing?.reducedMotion === false
						? 'false'
						: ''}
			>
				<option value="">herdar</option>
				<option value="true">forçar redução</option>
				<option value="false">forçar movimento</option>
			</select>
		</label>
		<div class="two">
			<label>
				SFX
				<select name="sfxCategory" value={existing?.sfxCategory ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_SFX_CATEGORIES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				IDs de SFX (herdar)
				<input name="sfxAssetIds" value={overrideSfxIds} placeholder="uuid, uuid" />
			</label>
		</div>
		<label class="check">
			<input type="checkbox" name="sfxOverride" checked={existing?.sfxAssetIds != null} />
			Substituir a lista de SFX (desmarcado herda)
		</label>
		<div class="two">
			<label>
				Voz
				<select name="voiceStyle" value={existing?.voiceStyle ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_VOICE_STYLES as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
			<label>
				Abertura
				<select name="openingHookKind" value={existing?.openingHookKind ?? ''}>
					<option value="">herdar</option>
					{#each STYLE_OPENING_HOOKS as value (value)}
						<option {value}>{value}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="two">
			<label>
				Capa
				<select name="coverTemplateId" value={existing?.coverTemplateId ?? ''}>
					<option value="">herdar</option>
					{#each COVER_TEMPLATE_LIST as template (template.id)}
						<option value={template.id}>{template.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Final A/B
				<select name="endCardTemplateId" value={existing?.endCardTemplateId ?? ''}>
					<option value="">herdar</option>
					{#each END_CARD_TEMPLATE_LIST as template (template.id)}
						<option value={template.id}>{template.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<label>
			CTA (herdar)
			<input name="ctaPrompt" maxlength="80" value={existing?.ctaPrompt ?? ''} />
		</label>
		<div class="override-actions">
			<button type="submit">{submitLabel}</button>
			<button
				type="submit"
				class="quiet"
				formaction={mode === 'scene' ? '?/clearSceneOverride' : '?/clearOverride'}
			>
				Limpar override
			</button>
		</div>
	</form>
{/if}

<style>
	.style-form {
		display: grid;
		gap: 0.6rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
		gap: 0.5rem;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		align-items: center;
		width: auto;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.override-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.quiet {
		background: transparent;
	}
	input[type='color'] {
		height: 2.2rem;
		padding: 0.15rem;
	}
	.live-preview {
		display: grid;
		gap: 0.4rem;
		justify-items: center;
		padding: 1rem;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		text-align: center;
	}
	.pv-title {
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.pv-caption {
		color: var(--accent);
		font-weight: 700;
		font-size: 0.8rem;
	}
	.pv-meta {
		color: var(--muted);
		font-size: 0.65rem;
	}
	.font-serif {
		font-family: Georgia, 'Times New Roman', serif;
	}
	.font-sans {
		font-family: 'Inter', 'Helvetica Neue', sans-serif;
	}
	.font-mono {
		font-family: 'DejaVu Sans Mono', monospace;
	}
	.font-display {
		font-family: 'Impact', 'Arial Black', sans-serif;
	}
</style>
