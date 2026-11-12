import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { listUploadSessions, listVideoAssets } from '#lib/server/video-assets.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const { data: episodes, error: episodesError } = await db
		.from('episodes')
		.select('id,title,episode_number,scene_duration_ms,status')
		.eq('owner_id', owner.id)
		.order('episode_number', { ascending: true });
	if (episodesError) throw new Error('Não foi possível carregar os episódios.');

	const requestedId = event.url.searchParams.get('episodeId');
	const selectedEpisode =
		(episodes ?? []).find((episode) => episode.id === requestedId) ?? (episodes ?? [])[0] ?? null;
	if (!selectedEpisode) {
		return {
			episodes: episodes ?? [],
			selectedEpisode: null,
			scenes: [],
			assets: [],
			sessions: [],
			videoConfigured: config.r2Configured || config.videoStorageDriver === 'memory',
			storageDriver: config.videoStorageDriver,
			probeDriver: config.videoProbeDriver,
		};
	}

	const { data: scenes, error: scenesError } = await db
		.from('scenes')
		.select('id,scene_index,start_ms,end_ms,location,prompt_status')
		.eq('owner_id', owner.id)
		.eq('episode_id', selectedEpisode.id)
		.order('scene_index', { ascending: true });
	if (scenesError) throw new Error('Não foi possível carregar as cenas.');

	const [assets, sessions] = await Promise.all([
		listVideoAssets({ db, owner, episodeId: selectedEpisode.id }),
		listUploadSessions({ db, owner, episodeId: selectedEpisode.id }),
	]);

	return {
		episodes: episodes ?? [],
		selectedEpisode,
		scenes: scenes ?? [],
		assets,
		sessions,
		videoConfigured: config.r2Configured || config.videoStorageDriver === 'memory',
		storageDriver: config.videoStorageDriver,
		probeDriver: config.videoProbeDriver,
	};
};
