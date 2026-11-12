import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select(
			'id,title,episode_number,status,duration_ms,narration_pt_br,platform_metadata,seasons(title,series(title))',
		)
		.eq('id', event.params.episodeId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (episodeError || !episode) error(404, 'Episódio não encontrado.');
	const [scenes, choices] = await Promise.all([
		db
			.from('scenes')
			.select(
				'id,scene_index,start_ms,end_ms,narration_pt_br,visual_description,start_frame_prompt_en,end_frame_prompt_en,motion_prompt_en,start_frame_asset_id,end_frame_asset_id',
			)
			.eq('episode_id', episode.id)
			.eq('owner_id', owner.id)
			.order('scene_index'),
		db
			.from('choices')
			.select('option_key,label,consequence')
			.eq('episode_id', episode.id)
			.eq('owner_id', owner.id)
			.order('option_key'),
	]);
	if (scenes.error || choices.error)
		error(503, 'Não foi possível preparar a prévia de exportação.');
	const ready =
		scenes.data?.filter((scene) => scene.narration_pt_br.trim() && scene.visual_description.trim())
			.length ?? 0;
	return {
		episode,
		scenes: scenes.data ?? [],
		choices: choices.data ?? [],
		warnings: {
			missingSceneNotes: (scenes.data?.length ?? 0) - ready,
			missingFrames: (scenes.data ?? []).reduce(
				(count, scene) =>
					count + Number(!scene.start_frame_asset_id) + Number(!scene.end_frame_asset_id),
				0,
			),
			missingChoices: choices.data?.length !== 2,
		},
	};
};
