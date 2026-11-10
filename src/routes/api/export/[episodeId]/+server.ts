import { PassThrough, Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v2 as cloudinary } from 'cloudinary';
import { buildSrt, csvCell, formatSrtTime } from '#lib/domain/timeline.js';
import { renderNarrativePrompt } from '#lib/domain/narrative-context.js';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { firstRelation } from '#lib/server/relations.js';
import { loadNarrativeContext } from '#lib/server/narrative-context.js';

function safeTime(value: number): string {
	return `${(value / 1000).toFixed(3)}s`;
}

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select(
			'id,title,episode_number,status,duration_ms,narration_pt_br,logline,hook,reveal,cliffhanger,platform_metadata,is_season_finale,seasons(title,planned_episode_count,series(title,premise,tone))',
		)
		.eq('id', event.params.episodeId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (episodeError || !episode) error(404, 'Episódio não encontrado.');
	const season = firstRelation(episode.seasons);
	const series = firstRelation(season?.series);
	const isSeasonFinale = Number(episode.episode_number) === Number(season?.planned_episode_count);
	let narrativeContext;
	try {
		narrativeContext = await loadNarrativeContext(db, owner.id, episode.id);
	} catch {
		error(503, 'Não foi possível preparar o contexto de continuidade da exportação.');
	}
	const [scenesQuery, choicesQuery] = await Promise.all([
		db
			.from('scenes')
			.select('*')
			.eq('episode_id', episode.id)
			.eq('owner_id', owner.id)
			.order('scene_index'),
		db
			.from('choices')
			.select('*')
			.eq('episode_id', episode.id)
			.eq('owner_id', owner.id)
			.order('option_key'),
	]);
	if (scenesQuery.error || choicesQuery.error)
		error(503, 'Não foi possível preparar a exportação.');
	const scenes = scenesQuery.data ?? [];
	const choices = choicesQuery.data ?? [];
	const sceneMedia = scenes.flatMap((scene) =>
		[
			scene.start_frame_asset_id
				? { sceneIndex: scene.scene_index, position: 'start', assetId: scene.start_frame_asset_id }
				: null,
			scene.end_frame_asset_id
				? { sceneIndex: scene.scene_index, position: 'end', assetId: scene.end_frame_asset_id }
				: null,
		].filter((item): item is { sceneIndex: number; position: 'start' | 'end'; assetId: string } =>
			Boolean(item),
		),
	);
	const assetIds = [...new Set(sceneMedia.map((entry) => entry.assetId))];
	const { data: assets, error: assetError } = assetIds.length
		? await db
				.from('media_assets')
				.select('id,public_id,resource_type,delivery_type,format,upload_status')
				.eq('owner_id', owner.id)
				.in('id', assetIds)
		: { data: [], error: null };
	if (assetError) error(503, 'Não foi possível validar os quadros vinculados.');
	const assetsById = new Map((assets ?? []).map((asset) => [asset.id, asset]));
	const metadata = episode.platform_metadata ?? {};
	const timelineRows = [
		[
			'scene',
			'start',
			'end',
			'narration_pt_br',
			'visual_description',
			'camera_notes',
			'lighting_notes',
			'start_frame_prompt_en',
			'end_frame_prompt_en',
			'motion_prompt_en',
			'audio_notes',
		].join(','),
		...scenes.map((scene) =>
			[
				scene.scene_index,
				safeTime(scene.start_ms),
				safeTime(scene.end_ms),
				scene.narration_pt_br,
				scene.visual_description,
				scene.camera_notes,
				scene.lighting_notes,
				scene.start_frame_prompt_en,
				scene.end_frame_prompt_en,
				scene.motion_prompt_en,
				scene.audio_notes,
			]
				.map(csvCell)
				.join(','),
		),
	].join('\r\n');
	const captions = scenes.map((scene) => ({
		index: scene.scene_index,
		startMs: scene.start_ms,
		endMs: scene.end_ms,
		narrationPtBr: scene.narration_pt_br,
	}));
	const srt = captions.some((scene) => scene.narrationPtBr.trim())
		? buildSrt(captions)
		: episode.narration_pt_br.trim()
			? `1\n${formatSrtTime(0)} --> ${formatSrtTime(episode.duration_ms)}\n${episode.narration_pt_br.trim()}\n`
			: '';
	const manifest = {
		format: 'dif-studio-flow-package/v1',
		createdAt: new Date().toISOString(),
		series: series?.title ?? '',
		season: season?.title ?? '',
		episode: {
			id: episode.id,
			number: episode.episode_number,
			title: episode.title,
			status: episode.status,
			durationMs: episode.duration_ms,
			isSeasonFinale,
			logline: episode.logline,
			hook: episode.hook,
			reveal: episode.reveal,
			cliffhanger: episode.cliffhanger,
		},
		canvas: {
			master: { aspectRatio: '9:16', width: 1080, height: 1920 },
			feed: [
				{ aspectRatio: '4:5', width: 1080, height: 1350 },
				{ aspectRatio: '3:4', width: 1080, height: 1440 },
			],
			sourceImagesArePreserved: true,
		},
		choices: choices.map((choice) => ({
			key: choice.option_key,
			label: choice.label,
			consequence: choice.consequence,
		})),
		continuity: {
			status: narrativeContext.latestPreviousCanon?.status ?? 'NO_PREVIOUS_PUBLISHED_EPISODE',
			previousEpisodeId: narrativeContext.latestPreviousCanon?.episodeId ?? null,
			approvedCanon: narrativeContext.latestPreviousCanon?.approvedCanon ?? null,
			contextPath: 'narrative/context.json',
		},
		scenes: scenes.map((scene) => ({
			index: scene.scene_index,
			startMs: scene.start_ms,
			endMs: scene.end_ms,
			startFrameAssetId: scene.start_frame_asset_id,
			endFrameAssetId: scene.end_frame_asset_id,
		})),
		warnings: [] as string[],
	};
	if (!scenes.length) manifest.warnings.push('NO_SCENES');
	if (!srt) manifest.warnings.push('NO_NARRATION_FOR_CAPTIONS');
	if (choices.length !== 2 && !isSeasonFinale) manifest.warnings.push('TWO_CHOICES_MISSING');

	const output = new PassThrough();
	const archive = new ZipArchive({ zlib: { level: 6 } });
	archive.on('error', (cause: Error) => output.destroy(cause));
	archive.pipe(output);
	archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' });
	archive.append(`${JSON.stringify(narrativeContext, null, 2)}\n`, {
		name: 'narrative/context.json',
	});
	archive.append(renderNarrativePrompt(narrativeContext, 145), {
		name: 'narrative/continuation-prompt.md',
	});
	archive.append(`${timelineRows}\r\n`, { name: 'timeline.csv' });
	archive.append(episode.narration_pt_br ?? '', { name: 'narration/narration-pt-BR.txt' });
	archive.append(srt, { name: 'captions/captions.srt' });
	archive.append(
		[
			['scene', 'start_ms', 'end_ms', 'caption_pt_br'].join(','),
			...captions
				.filter((scene) => scene.narrationPtBr.trim())
				.map((scene) =>
					[scene.index, scene.startMs, scene.endMs, scene.narrationPtBr].map(csvCell).join(','),
				),
		].join('\r\n') + '\r\n',
		{ name: 'captions/captions.csv' },
	);
	archive.append(String(metadata.tiktok_caption ?? ''), { name: 'social/tiktok-caption.txt' });
	archive.append(String(metadata.instagram_caption ?? ''), {
		name: 'social/instagram-caption.txt',
	});
	archive.append(
		`${JSON.stringify(
			{
				speechSpeedWpm: metadata.speech_speed_wpm ?? 145,
				screenSuggestion: metadata.screen_suggestion ?? '',
				soundSuggestion: metadata.sound_suggestion ?? '',
				tiktok: {
					title: metadata.tiktok_title ?? '',
					cta: metadata.tiktok_cta ?? '',
					description: metadata.tiktok_description ?? '',
				},
				instagram: {
					title: metadata.instagram_title ?? '',
					cta: metadata.instagram_cta ?? '',
					description: metadata.instagram_description ?? '',
				},
			},
			null,
			2,
		)}\n`,
		{ name: 'social/platform-copy.json' },
	);
	archive.append(
		`${JSON.stringify({ coverText: metadata.cover_text ?? '', master: '9:16 / 1080x1920', safeZones: 'Keep title, captions and key subject inside the central safe area. Confirm overlays in the target app.' }, null, 2)}\n`,
		{ name: 'social/cover-metadata.json' },
	);
	archive.append(
		'DIF Studio Flow / CapCut package\n\nUse Google Flow and CapCut manually. No video is rendered and no post is published by this package. Check missing_frames.json before editing. Original imported frames are preserved.\n',
		{ name: 'README.txt' },
	);
	for (const scene of scenes) {
		const prompt =
			[
				`# Scene ${String(scene.scene_index).padStart(2, '0')}`,
				`Timeline: ${safeTime(scene.start_ms)} — ${safeTime(scene.end_ms)}`,
				`Narration (pt-BR):\n${scene.narration_pt_br || '(not written)'}`,
				`Visual description:\n${scene.visual_description || '(not written)'}`,
				`Start frame prompt (English):\n${scene.start_frame_prompt_en || '(not written)'}`,
				`End frame prompt (English):\n${scene.end_frame_prompt_en || '(not written)'}`,
				`Motion prompt (English):\n${scene.motion_prompt_en || '(not written)'}`,
				`Camera: ${scene.camera_notes || '(not written)'}`,
				`Lighting: ${scene.lighting_notes || '(not written)'}`,
				`Audio: ${scene.audio_notes || '(not written)'}`,
			].join('\n\n') + '\n';
		archive.append(prompt, {
			name: `storyboard/scene-${String(scene.scene_index).padStart(2, '0')}.md`,
		});
	}
	const headers = {
		'content-type': 'application/zip',
		'content-disposition': `attachment; filename="dif-episode-${String(episode.episode_number).padStart(2, '0')}.zip"`,
		'cache-control': 'private, no-store',
		'x-content-type-options': 'nosniff',
	};

	void (async () => {
		const missing: Array<{ scene: number; position: string; assetId: string; reason: string }> = [];
		if (
			sceneMedia.length &&
			config.cloudinaryConfigured &&
			config.cloudinaryCloudName &&
			config.cloudinaryApiKey &&
			config.cloudinaryApiSecret
		) {
			cloudinary.config({
				cloud_name: config.cloudinaryCloudName,
				api_key: config.cloudinaryApiKey,
				api_secret: config.cloudinaryApiSecret,
				secure: true,
			});
			for (const entry of sceneMedia) {
				const asset = assetsById.get(entry.assetId);
				if (
					!asset ||
					asset.upload_status !== 'READY' ||
					asset.resource_type !== 'image' ||
					!['authenticated', 'private'].includes(asset.delivery_type)
				) {
					missing.push({
						scene: entry.sceneIndex,
						position: entry.position,
						assetId: entry.assetId,
						reason: 'METADATA_NOT_READY',
					});
					continue;
				}
				try {
					const signedUrl = cloudinary.utils.private_download_url(asset.public_id, asset.format, {
						resource_type: 'image',
						type: asset.delivery_type,
						attachment: false,
						expires_at: Math.floor(Date.now() / 1000) + 300,
					});
					const response = await fetch(signedUrl, {
						signal: AbortSignal.timeout(15_000),
						redirect: 'error',
					});
					if (!response.ok) throw new Error('Private image unavailable.');
					const bytes = Buffer.from(await response.arrayBuffer());
					archive.append(bytes, {
						name: `media/scene-${String(entry.sceneIndex).padStart(2, '0')}-${entry.position}.${asset.format}`,
					});
				} catch {
					missing.push({
						scene: entry.sceneIndex,
						position: entry.position,
						assetId: entry.assetId,
						reason: 'PRIVATE_DELIVERY_UNAVAILABLE',
					});
				}
			}
		} else {
			for (const entry of sceneMedia)
				missing.push({
					scene: entry.sceneIndex,
					position: entry.position,
					assetId: entry.assetId,
					reason: 'CLOUDINARY_NOT_CONFIGURED',
				});
		}
		archive.append(`${JSON.stringify(missing, null, 2)}\n`, { name: 'missing_frames.json' });
		await archive.finalize();
	})().catch((cause: unknown) => {
		output.destroy(cause instanceof Error ? cause : new Error('Export failed.'));
	});

	return new Response(Readable.toWeb(output) as ReadableStream, { headers });
};
