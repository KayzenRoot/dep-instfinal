import type {
	EditPlanPreview,
	PlatformProfileId,
	PreviewBox,
} from '#lib/schemas/platform-preview.js';

export class PlatformPreviewError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'PlatformPreviewError';
	}
}

export interface PreviewZone extends PreviewBox {
	label: string;
}

export interface PlatformPreviewProfile {
	id: PlatformProfileId;
	label: string;
	version: 1;
	source: string;
	disclaimer: string;
	safeArea: PreviewBox;
	/** Simulated app chrome; these regions are unsafe for text/CTA. */
	uiZones: PreviewZone[];
	captionBox: PreviewBox;
	ctaBox: PreviewBox;
	/** 4:5 centered crop used by feed/cover previews. */
	coverBox: PreviewBox;
}

/**
 * Conservative internal profiles, not pixel-exact copies of the current apps.
 * The Reels profile follows Meta ad-guidance margins as a conservative
 * approximation for organic Reels; it is not an official organic guarantee.
 */
export const PLATFORM_PREVIEW_PROFILES: Record<PlatformProfileId, PlatformPreviewProfile> = {
	tiktok: {
		id: 'tiktok',
		label: 'TikTok 9:16',
		version: 1,
		source: 'DIF Studio internal conservative profile v1 (2026-11-18)',
		disclaimer:
			'Simulação conservadora da interface do TikTok; a UI real pode mudar. Revise no aparelho antes de publicar.',
		safeArea: { x: 48, y: 180, width: 984, height: 1_500 },
		uiZones: [
			{ x: 0, y: 0, width: 1_080, height: 150, label: 'Topo' },
			{ x: 900, y: 860, width: 160, height: 720, label: 'Ações laterais' },
			{ x: 48, y: 1_680, width: 870, height: 200, label: 'Descrição e áudio' },
		],
		captionBox: { x: 90, y: 1_320, width: 810, height: 240 },
		ctaBox: { x: 120, y: 1_020, width: 780, height: 220 },
		coverBox: { x: 0, y: 285, width: 1_080, height: 1_350 },
	},
	reels: {
		id: 'reels',
		label: 'Instagram Reels 9:16',
		version: 1,
		source: 'DIF Studio internal conservative profile v1 (2026-11-18)',
		disclaimer:
			'Perfil conservador inspirado em orientações de anúncios da Meta; não é medida exata do Reels orgânico. Revise no aparelho.',
		safeArea: { x: 48, y: 220, width: 984, height: 1_430 },
		uiZones: [
			{ x: 0, y: 0, width: 1_080, height: 180, label: 'Topo' },
			{ x: 900, y: 960, width: 160, height: 620, label: 'Ações laterais' },
			{ x: 48, y: 1_650, width: 870, height: 220, label: 'Legenda e áudio' },
		],
		captionBox: { x: 90, y: 1_310, width: 810, height: 240 },
		ctaBox: { x: 120, y: 1_000, width: 780, height: 220 },
		coverBox: { x: 0, y: 285, width: 1_080, height: 1_350 },
	},
	clean: {
		id: 'clean',
		label: 'Conteúdo limpo 9:16',
		version: 1,
		source: 'DIF Studio internal clean profile v1 (2026-11-18)',
		disclaimer: 'Sem simulação de interface; margens conservadoras para edição e arquivo.',
		safeArea: { x: 60, y: 60, width: 960, height: 1_700 },
		uiZones: [],
		captionBox: { x: 90, y: 1_440, width: 900, height: 240 },
		ctaBox: { x: 240, y: 1_130, width: 600, height: 200 },
		coverBox: { x: 0, y: 285, width: 1_080, height: 1_350 },
	},
};

export interface ResolvedPreviewLayout {
	profile: PlatformPreviewProfile;
	captionBox: PreviewBox;
	ctaBox: PreviewBox;
	custom: boolean;
	captionMode: 'caption' | 'cta';
}

export function defaultPreview(profileId: PlatformProfileId = 'tiktok'): EditPlanPreview {
	const profile = PLATFORM_PREVIEW_PROFILES[profileId];
	return {
		profileId,
		profileVersion: 1,
		captionBox: { ...profile.captionBox },
		ctaBox: { ...profile.ctaBox },
	};
}

export function resolvePreviewLayout(preview?: EditPlanPreview | null): ResolvedPreviewLayout {
	if (preview && preview.profileVersion !== 1)
		throw new PlatformPreviewError(
			'PREVIEW_PROFILE_VERSION_UNSUPPORTED',
			'Versão de perfil de prévia não suportada.',
		);
	const profile = PLATFORM_PREVIEW_PROFILES[preview?.profileId ?? 'tiktok'];
	return {
		profile,
		captionBox: preview?.captionBox ?? profile.captionBox,
		ctaBox: preview?.ctaBox ?? profile.ctaBox,
		custom: Boolean(preview?.captionBox || preview?.ctaBox),
		captionMode: 'caption',
	};
}

function intersectionArea(left: PreviewBox, right: PreviewBox): number {
	const width = Math.max(
		0,
		Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
	);
	const height = Math.max(
		0,
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
	);
	return width * height;
}

function inside(inner: PreviewBox, outer: PreviewBox): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

export type PreviewSeverity = 'HIGH' | 'MEDIUM';

export interface PreviewCollision {
	code: string;
	severity: PreviewSeverity;
	target: 'caption' | 'cta' | 'layout';
	message: string;
	area: number;
}

export interface PreviewCollisionOptions {
	caption?: boolean;
	cta?: boolean;
}

export function detectPreviewCollisions(
	preview?: EditPlanPreview | null,
	options: PreviewCollisionOptions = {},
): PreviewCollision[] {
	const layout = resolvePreviewLayout(preview);
	const checkCaption = options.caption ?? true;
	const checkCta = options.cta ?? true;
	const collisions: PreviewCollision[] = [];
	const check = (target: 'caption' | 'cta', box: PreviewBox, label: string) => {
		if (!inside(box, layout.profile.safeArea))
			collisions.push({
				code: `${target.toUpperCase()}_OUTSIDE_SAFE`,
				severity: 'HIGH',
				target,
				message: `${label} está fora da área segura simulada do perfil.`,
				area: 0,
			});
		for (const zone of layout.profile.uiZones) {
			const area = intersectionArea(box, zone);
			if (area > 0)
				collisions.push({
					code: `${target.toUpperCase()}_UI_COLLISION`,
					severity: 'HIGH',
					target,
					message: `${label} colide com ${zone.label} na simulação.`,
					area,
				});
		}
	};
	if (checkCaption) check('caption', layout.captionBox, 'A legenda');
	if (checkCta) check('cta', layout.ctaBox, 'A CTA');
	const overlap = intersectionArea(layout.captionBox, layout.ctaBox);
	if (checkCaption && checkCta && overlap > 0)
		collisions.push({
			code: 'CAPTION_CTA_OVERLAP',
			severity: 'HIGH',
			target: 'layout',
			message: 'Legenda e CTA se sobrepõem.',
			area: overlap,
		});
	return collisions;
}

export function assertPreviewLayout(
	preview?: EditPlanPreview | null,
	options: PreviewCollisionOptions = {},
): ResolvedPreviewLayout {
	const layout = resolvePreviewLayout(preview);
	const checkCaption = options.caption ?? true;
	const checkCta = options.cta ?? true;
	const high = detectPreviewCollisions(preview, options).filter(
		(collision) => collision.severity === 'HIGH',
	);
	if (high.length)
		throw new PlatformPreviewError(
			'PREVIEW_LAYOUT_UNSAFE',
			high.map((collision) => collision.message).join(' '),
		);
	if (checkCaption && (layout.captionBox.width < 600 || layout.captionBox.height < 140))
		throw new PlatformPreviewError(
			'PREVIEW_CAPTION_BOX_SMALL',
			'A caixa de legenda precisa de pelo menos 600 × 140 px.',
		);
	if (checkCta && (layout.ctaBox.width < 500 || layout.ctaBox.height < 120))
		throw new PlatformPreviewError(
			'PREVIEW_CTA_BOX_SMALL',
			'A caixa de CTA precisa de pelo menos 500 × 120 px.',
		);
	return layout;
}

/**
 * Plans saved before WO-011 have no `preview` and keep their historical ASS
 * layout (880 px safe width, style margins). Only plans with an explicit
 * preview are forced through the platform safe-zone boxes.
 */
export function layoutFromPlan(plan: {
	preview?: EditPlanPreview;
	captions?: { template: string };
	cta?: { enabled: boolean } | null;
}): { captionBox: PreviewBox; ctaBox: PreviewBox } | null {
	if (!plan.preview) return null;
	const layout = assertPreviewLayout(plan.preview, {
		caption: plan.captions?.template !== 'none',
		cta: Boolean(plan.cta?.enabled),
	});
	return { captionBox: layout.captionBox, ctaBox: layout.ctaBox };
}
