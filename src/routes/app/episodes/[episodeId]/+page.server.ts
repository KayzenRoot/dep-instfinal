import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	canonicalDecisionSchema,
	choiceEditSchema,
	episodeEditSchema,
	narrativeResponseSchema,
	pollResultSchema,
	sceneEditSchema,
} from '#lib/schemas/story.js';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';
import { loadNarrativeContext } from '#lib/server/narrative-context.js';
import { estimateNarrationDurationSeconds } from '#lib/domain/narrative-context.js';

function publicationBlockMessage(message: string): string {
	const reason = message.toLowerCase();
	if (reason.includes('episode_previous_episode_missing'))
		return 'A publicação está aguardando: crie e publique o episódio imediatamente anterior antes desta continuação.';
	if (reason.includes('episode_previous_poll_missing'))
		return 'A publicação está aguardando: registre e encerre a votação do episódio anterior.';
	if (reason.includes('episode_previous_vote_open'))
		return 'A publicação está aguardando: encerre a votação aberta do episódio anterior.';
	if (reason.includes('episode_previous_vote_not_verified'))
		return 'A publicação está aguardando: a votação do episódio anterior precisa ser encerrada e verificada.';
	if (reason.includes('episode_previous_result_missing'))
		return 'A publicação está aguardando: registre os totais verificados da votação anterior.';
	if (reason.includes('episode_previous_result_unverified'))
		return 'A publicação está aguardando: verifique o resultado mais recente da votação anterior.';
	if (reason.includes('episode_previous_winner_invalid'))
		return 'A publicação está aguardando: o resultado anterior precisa ter um vencedor válido, opção 1 ou 2.';
	if (reason.includes('episode_previous_canon_stale'))
		return 'A publicação está aguardando: a decisão aprovada está desatualizada. Revise e aprove a decisão correspondente ao resultado mais recente.';
	if (reason.includes('episode_previous_canon_pending'))
		return 'A publicação está aguardando: revise e aprove a decisão canônica do resultado verificado mais recente.';
	return 'Não foi possível publicar. Revise o estado do episódio e as validações da temporada.';
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodeId = event.params.episodeId;
	const [episodeResult, scenesResult, choicesResult, revisionsResult, pollResult, mediaResult] =
		await Promise.all([
			db
				.from('episodes')
				.select('*,seasons(id,title,planned_episode_count,series_id,series(id,title,premise,tone))')
				.eq('id', episodeId)
				.eq('owner_id', owner.id)
				.maybeSingle(),
			db
				.from('scenes')
				.select('*')
				.eq('episode_id', episodeId)
				.eq('owner_id', owner.id)
				.order('scene_index'),
			db
				.from('choices')
				.select('*')
				.eq('episode_id', episodeId)
				.eq('owner_id', owner.id)
				.order('option_key'),
			db
				.from('episode_revisions')
				.select('id,revision_number,change_note,created_at')
				.eq('episode_id', episodeId)
				.eq('owner_id', owner.id)
				.order('revision_number', { ascending: false })
				.limit(20),
			db
				.from('polls')
				.select('*')
				.eq('episode_id', episodeId)
				.eq('owner_id', owner.id)
				.maybeSingle(),
			db
				.from('media_assets')
				.select('id,asset_kind,format,width,height,upload_status')
				.eq('owner_id', owner.id)
				.eq('upload_status', 'READY')
				.order('created_at', { ascending: false }),
		]);
	if (episodeResult.error || !episodeResult.data) error(404, 'Episódio não encontrado.');
	if (
		scenesResult.error ||
		choicesResult.error ||
		revisionsResult.error ||
		pollResult.error ||
		mediaResult.error
	)
		error(503, 'Não foi possível carregar o caderno do episódio.');
	const poll = pollResult.data;
	const season = firstRelation(episodeResult.data.seasons);
	const episode = {
		...episodeResult.data,
		is_season_finale:
			Number(episodeResult.data.episode_number) === Number(season?.planned_episode_count),
		seasons: season ? { ...season, series: firstRelation(season.series) } : null,
	};
	let results: Array<{
		id: string;
		revision_number: number;
		option_1_count: number;
		option_2_count: number;
		winner_option: '1' | '2' | null;
		evidence_source: string;
		verification_note: string;
		created_at: string;
	}> = [];
	let decisions: Array<{
		id: string;
		revision_number: number;
		rationale: string;
		created_at: string;
	}> = [];
	if (poll) {
		const [resultQuery, decisionQuery] = await Promise.all([
			db
				.from('poll_results')
				.select('*')
				.eq('poll_id', poll.id)
				.eq('owner_id', owner.id)
				.order('revision_number', { ascending: false }),
			db
				.from('canonical_decisions')
				.select('*')
				.eq('poll_id', poll.id)
				.eq('owner_id', owner.id)
				.order('revision_number', { ascending: false }),
		]);
		if (resultQuery.error || decisionQuery.error)
			error(503, 'Não foi possível carregar o histórico de continuidade.');
		results = resultQuery.data ?? [];
		decisions = decisionQuery.data ?? [];
	}
	let narrativeContext;
	try {
		narrativeContext = await loadNarrativeContext(db, owner.id, episodeId);
	} catch {
		error(503, 'Não foi possível preparar o contexto narrativo e canônico.');
	}
	return {
		episode,
		scenes: scenesResult.data ?? [],
		choices: choicesResult.data ?? [],
		revisions: revisionsResult.data ?? [],
		mediaAssets: mediaResult.data ?? [],
		poll,
		results,
		decisions,
		narrativeContext,
		ownerId: owner.id,
	};
};

export const actions: Actions = {
	saveEpisode: async (event) => {
		const { db } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = episodeEditSchema.safeParse({
			episodeId: event.params.episodeId,
			title: readFormText(form, 'title'),
			logline: readFormText(form, 'logline'),
			hook: readFormText(form, 'hook'),
			narrative: readFormText(form, 'narrative'),
			reveal: readFormText(form, 'reveal'),
			cliffhanger: readFormText(form, 'cliffhanger'),
			narrationPtBr: readFormText(form, 'narrationPtBr'),
			screenSuggestion: readFormText(form, 'screenSuggestion'),
			soundSuggestion: readFormText(form, 'soundSuggestion'),
			tiktokTitle: readFormText(form, 'tiktokTitle'),
			tiktokCta: readFormText(form, 'tiktokCta'),
			tiktokDescription: readFormText(form, 'tiktokDescription'),
			instagramTitle: readFormText(form, 'instagramTitle'),
			instagramCta: readFormText(form, 'instagramCta'),
			instagramDescription: readFormText(form, 'instagramDescription'),
			coverText: readFormText(form, 'coverText'),
			durationSeconds: readFormText(form, 'durationSeconds'),
			speechSpeedWpm: readFormText(form, 'speechSpeedWpm') || 145,
			isSeasonFinale: form.get('isSeasonFinale') === 'on',
		});
		if (!parsed.success)
			return fail(400, { message: 'Revise título, duração (90–150s) e campos do roteiro.' });
		const { error: saveError } = await db.rpc('save_episode_content', {
			p_episode_id: event.params.episodeId,
			p_title: parsed.data.title,
			p_logline: parsed.data.logline,
			p_hook: parsed.data.hook,
			p_narrative: parsed.data.narrative,
			p_reveal: parsed.data.reveal,
			p_cliffhanger: parsed.data.cliffhanger,
			p_narration_pt_br: parsed.data.narrationPtBr,
			p_duration_ms: parsed.data.durationSeconds * 1000,
			p_is_season_finale: parsed.data.isSeasonFinale,
			p_platform_metadata: {
				speech_speed_wpm: parsed.data.speechSpeedWpm,
				screen_suggestion: parsed.data.screenSuggestion,
				sound_suggestion: parsed.data.soundSuggestion,
				tiktok_title: parsed.data.tiktokTitle,
				tiktok_cta: parsed.data.tiktokCta,
				tiktok_description: parsed.data.tiktokDescription,
				instagram_title: parsed.data.instagramTitle,
				instagram_cta: parsed.data.instagramCta,
				instagram_description: parsed.data.instagramDescription,
				tiktok_caption: [
					parsed.data.tiktokTitle,
					parsed.data.tiktokCta,
					parsed.data.tiktokDescription,
				]
					.filter(Boolean)
					.join('\n\n'),
				instagram_caption: [
					parsed.data.instagramTitle,
					parsed.data.instagramCta,
					parsed.data.instagramDescription,
				]
					.filter(Boolean)
					.join('\n\n'),
				cover_text: parsed.data.coverText,
			},
		});
		if (saveError)
			return fail(409, {
				message:
					'Não foi possível salvar. Episódios publicados são imutáveis; revise a duração e as imagens associadas.',
			});
		return {
			episodeSaved: true,
			estimatedDurationSeconds: estimateNarrationDurationSeconds(
				parsed.data.narrationPtBr,
				parsed.data.speechSpeedWpm,
			),
		};
	},
	importNarrativeResponse: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler a resposta narrativa.' });
		if (form.get('confirmImport') !== 'on')
			return fail(400, { message: 'Confirme que revisou a resposta antes de importar.' });
		const serializedResponse = readFormText(form, 'responseJson');
		if (serializedResponse.length > 60_000)
			return fail(413, { message: 'A resposta excede o limite de 60 KB.' });
		let decoded: unknown;
		try {
			decoded = JSON.parse(serializedResponse);
		} catch {
			return fail(400, { message: 'A resposta precisa conter um objeto JSON válido.' });
		}
		const parsed = narrativeResponseSchema.safeParse(decoded);
		if (!parsed.success)
			return fail(400, {
				message:
					'JSON inválido: revise campos obrigatórios, duas opções distintas (exceto no final da temporada) e duração estimada entre 90 e 150 segundos.',
			});
		const response = parsed.data;
		const { data: targetEpisode, error: targetEpisodeError } = await db
			.from('episodes')
			.select('id,episode_number,seasons(planned_episode_count)')
			.eq('id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		const targetSeason = targetEpisode ? firstRelation(targetEpisode.seasons) : null;
		if (targetEpisodeError || !targetEpisode || !targetSeason)
			return fail(404, { message: 'Episódio não encontrado nesta temporada.' });
		const isSeasonFinale =
			Number(targetEpisode.episode_number) === Number(targetSeason.planned_episode_count);
		if (!isSeasonFinale && response.choices.length !== 2)
			return fail(400, {
				message: 'Este episódio ainda terá continuação e exige duas opções de votação diferentes.',
			});
		const metadata = {
			speech_speed_wpm: response.speechSpeedWpm,
			screen_suggestion: response.screenSuggestion,
			sound_suggestion: response.soundSuggestion,
			cover_text: response.coverText,
			tiktok_title: response.tiktok.title,
			tiktok_cta: response.tiktok.cta,
			tiktok_description: response.tiktok.description,
			tiktok_caption: [
				response.tiktok.title,
				response.tiktok.cta,
				response.tiktok.description,
			].join('\n\n'),
			instagram_title: response.instagram.title,
			instagram_cta: response.instagram.cta,
			instagram_description: response.instagram.description,
			instagram_caption: [
				response.instagram.title,
				response.instagram.cta,
				response.instagram.description,
			].join('\n\n'),
		};
		const { error: importError } = await db.rpc('import_narrative_response', {
			p_episode_id: event.params.episodeId,
			p_title: response.title,
			p_logline: response.logline,
			p_hook: response.hook,
			p_narrative: response.narrative,
			p_reveal: response.reveal,
			p_cliffhanger: response.cliffhanger,
			p_narration_pt_br: response.narrationPtBr,
			p_duration_ms: response.durationSeconds * 1000,
			p_platform_metadata: metadata,
			p_option_1_label: response.choices[0]?.label ?? null,
			p_option_1_consequence: response.choices[0]?.consequence ?? null,
			p_option_2_label: response.choices[1]?.label ?? null,
			p_option_2_consequence: response.choices[1]?.consequence ?? null,
		});
		if (importError)
			return fail(409, {
				message:
					'A resposta não foi importada. O episódio publicado ou a revisão não foi alterado.',
			});
		return {
			responseImported: true,
			estimatedDurationSeconds: estimateNarrationDurationSeconds(
				response.narrationPtBr,
				response.speechSpeedWpm,
			),
		};
	},
	saveScene: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = sceneEditSchema.safeParse(
			Object.fromEntries(
				[
					'sceneId',
					'narrationPtBr',
					'visualDescription',
					'cameraNotes',
					'lightingNotes',
					'startFramePromptEn',
					'endFramePromptEn',
					'motionPromptEn',
					'audioNotes',
				].map((key) => [key, readFormText(form, key)]),
			),
		);
		if (!parsed.success) return fail(400, { message: 'Revise os campos do storyboard.' });
		const { data: scene, error: sceneQueryError } = await db
			.from('scenes')
			.select('id')
			.eq('id', parsed.data.sceneId)
			.eq('episode_id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (sceneQueryError || !scene)
			return fail(404, { message: 'Cena não encontrada neste episódio.' });
		const { error: saveError } = await db.rpc('save_episode_scene', {
			p_scene_id: parsed.data.sceneId,
			p_narration_pt_br: parsed.data.narrationPtBr,
			p_visual_description: parsed.data.visualDescription,
			p_camera_notes: parsed.data.cameraNotes,
			p_lighting_notes: parsed.data.lightingNotes,
			p_start_frame_prompt_en: parsed.data.startFramePromptEn,
			p_end_frame_prompt_en: parsed.data.endFramePromptEn,
			p_motion_prompt_en: parsed.data.motionPromptEn,
			p_audio_notes: parsed.data.audioNotes,
		});
		if (saveError)
			return fail(409, {
				message: 'Não foi possível salvar a cena. Conteúdo publicado não pode ser alterado.',
			});
		return { sceneSaved: true };
	},
	saveFrames: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const sceneId = readFormText(form, 'sceneId');
		const startFrameAssetId = readFormText(form, 'startFrameAssetId') || null;
		const endFrameAssetId = readFormText(form, 'endFrameAssetId') || null;
		if (
			!/^[0-9a-f-]{36}$/i.test(sceneId) ||
			(startFrameAssetId && !/^[0-9a-f-]{36}$/i.test(startFrameAssetId)) ||
			(endFrameAssetId && !/^[0-9a-f-]{36}$/i.test(endFrameAssetId))
		)
			return fail(400, { message: 'Seleção de quadro inválida.' });
		const { data: scene, error: sceneError } = await db
			.from('scenes')
			.select('id')
			.eq('id', sceneId)
			.eq('episode_id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (sceneError || !scene) return fail(404, { message: 'Cena não encontrada neste episódio.' });
		const { error: saveError } = await db.rpc('attach_scene_frames', {
			p_scene_id: sceneId,
			p_start_asset_id: startFrameAssetId,
			p_end_asset_id: endFrameAssetId,
		});
		if (saveError)
			return fail(409, {
				message:
					'Não foi possível vincular os quadros. Imagens publicadas não podem ser alteradas.',
			});
		return { framesSaved: true };
	},
	saveChoices: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = choiceEditSchema.safeParse(
			Object.fromEntries(
				[
					'episodeId',
					'option1Label',
					'option1Consequence',
					'option2Label',
					'option2Consequence',
				].map((key) => [
					key,
					key === 'episodeId' ? event.params.episodeId : readFormText(form, key),
				]),
			),
		);
		if (!parsed.success)
			return fail(400, { message: 'Escreva duas opções distintas e suas consequências.' });
		const { data: episode, error: episodeError } = await db
			.from('episodes')
			.select('id')
			.eq('id', parsed.data.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (episodeError || !episode) return fail(404, { message: 'Episódio não encontrado.' });
		const { error: saveError } = await db.rpc('save_episode_choices', {
			p_episode_id: episode.id,
			p_option_1_label: parsed.data.option1Label,
			p_option_1_consequence: parsed.data.option1Consequence,
			p_option_2_label: parsed.data.option2Label,
			p_option_2_consequence: parsed.data.option2Consequence,
		});
		if (saveError) return fail(409, { message: 'Não foi possível salvar as opções do episódio.' });
		return { choicesSaved: true };
	},
	markReady: async (event) => {
		const { db } = ownerDatabase(event);
		const { error: statusError } = await db.rpc('set_episode_status', {
			p_episode_id: event.params.episodeId,
			p_status: 'READY',
		});
		if (statusError)
			return fail(409, {
				message:
					'Antes de marcar como pronto, revise a linha do tempo e as duas opções. O episódio final pode não ter opções.',
			});
		return { statusSaved: true };
	},
	publish: async (event) => {
		const { db } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (form?.get('publishConfirmed') !== 'on')
			return fail(400, { message: 'Confirme que revisou o episódio antes de publicar.' });
		const { error: statusError } = await db.rpc('set_episode_status', {
			p_episode_id: event.params.episodeId,
			p_status: 'PUBLISHED',
		});
		if (statusError)
			return fail(409, {
				message: publicationBlockMessage(statusError.message),
			});
		return { statusSaved: true };
	},
	createPoll: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const hours = Number(readFormText(form, 'durationHours'));
		const tieBreakOption = readFormText(form, 'tieBreakOption');
		const tieBreakRule = readFormText(form, 'tieBreakRule').trim();
		const externalPostId = readFormText(form, 'externalPostId').trim();
		if (
			!Number.isInteger(hours) ||
			hours < 1 ||
			hours > 168 ||
			!['1', '2'].includes(tieBreakOption) ||
			!tieBreakRule ||
			tieBreakRule.length > 500 ||
			externalPostId.length > 200
		) {
			return fail(400, {
				message: 'Revise o prazo e publique previamente uma regra para desempate.',
			});
		}
		const { data: episode, error: episodeError } = await db
			.from('episodes')
			.select('id,status,episode_number,seasons(planned_episode_count)')
			.eq('id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		const pollSeason = episode ? firstRelation(episode.seasons) : null;
		const isSeasonFinale =
			episode && pollSeason
				? Number(episode.episode_number) === Number(pollSeason.planned_episode_count)
				: false;
		if (episodeError || !episode || episode.status !== 'PUBLISHED' || isSeasonFinale)
			return fail(409, {
				message: 'A votação exige um episódio publicado que não seja final de temporada.',
			});
		const { data: choices, error: choicesError } = await db
			.from('choices')
			.select('id')
			.eq('episode_id', episode.id)
			.eq('owner_id', owner.id);
		if (choicesError || choices?.length !== 2)
			return fail(409, { message: 'A votação exige exatamente duas opções salvas.' });
		const openedAt = new Date();
		const closesAt = new Date(openedAt.getTime() + hours * 60 * 60 * 1000);
		const { error: pollError } = await db.from('polls').insert({
			owner_id: owner.id,
			episode_id: episode.id,
			external_post_id: externalPostId || null,
			status: 'OPEN',
			opened_at: openedAt.toISOString(),
			closes_at: closesAt.toISOString(),
			tie_break_rule: tieBreakRule,
			tie_break_option: tieBreakOption,
		});
		if (pollError)
			return fail(409, {
				message: 'Não foi possível abrir a votação. Confira o estado atual do episódio.',
			});
		return { pollCreated: true };
	},
	closePoll: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const pollId = readFormText(form, 'pollId');
		const { data: poll, error: pollError } = await db
			.from('polls')
			.select('id,status')
			.eq('id', pollId)
			.eq('episode_id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (pollError || !poll || poll.status !== 'OPEN')
			return fail(409, { message: 'A votação não está aberta.' });
		const { error: updateError } = await db
			.from('polls')
			.update({ status: 'CLOSED', closed_at: new Date().toISOString() })
			.eq('id', poll.id)
			.eq('owner_id', owner.id);
		if (updateError) return fail(409, { message: 'Não foi possível registrar o encerramento.' });
		return { pollClosed: true };
	},
	recordResult: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		if (form.get('confirmVerified') !== 'on')
			return fail(400, { message: 'Confirme a verificação antes de registrar os totais.' });
		const capturedAt = new Date().toISOString();
		const parsed = pollResultSchema.safeParse({
			pollId: readFormText(form, 'pollId'),
			option1Count: readFormText(form, 'option1Count'),
			option2Count: readFormText(form, 'option2Count'),
			evidenceSource: readFormText(form, 'evidenceSource'),
			capturedAt,
			verificationNote: readFormText(form, 'verificationNote'),
		});
		if (!parsed.success)
			return fail(400, { message: 'Informe totais inteiros e uma fonte de verificação.' });
		const { data: poll, error: pollError } = await db
			.from('polls')
			.select('id,status,tie_break_option')
			.eq('id', parsed.data.pollId)
			.eq('episode_id', event.params.episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (pollError || !poll || !['CLOSED', 'VERIFIED'].includes(poll.status))
			return fail(409, { message: 'Encerre a votação antes de registrar os totais.' });
		const { data: prior, error: priorError } = await db
			.from('poll_results')
			.select('id,revision_number')
			.eq('poll_id', poll.id)
			.eq('owner_id', owner.id)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (priorError)
			return fail(503, { message: 'Não foi possível carregar o histórico de resultados.' });
		const one = parsed.data.option1Count;
		const two = parsed.data.option2Count;
		const winner =
			one === 0 && two === 0 ? null : one > two ? '1' : two > one ? '2' : poll.tie_break_option;
		const { error: insertError } = await db.from('poll_results').insert({
			owner_id: owner.id,
			poll_id: poll.id,
			revision_number: (prior?.revision_number ?? 0) + 1,
			option_1_count: one,
			option_2_count: two,
			winner_option: winner,
			verification_status: 'VERIFIED',
			evidence_source: parsed.data.evidenceSource,
			captured_at: parsed.data.capturedAt,
			verified_at: new Date().toISOString(),
			verification_note: parsed.data.verificationNote,
			supersedes_result_id: prior?.id ?? null,
		});
		if (insertError)
			return fail(409, {
				message: 'Não foi possível salvar o resultado. Nenhum total foi aceito automaticamente.',
			});
		return { resultSaved: true };
	},
	approveCanon: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		if (form.get('acceptCanon') !== 'on')
			return fail(400, { message: 'Confirme a aprovação do novo cânone.' });
		const parsed = canonicalDecisionSchema.safeParse({
			pollId: readFormText(form, 'pollId'),
			pollResultId: readFormText(form, 'pollResultId'),
			canonSnapshot: readFormText(form, 'canonSnapshot'),
			rationale: readFormText(form, 'rationale'),
			acceptedBy: 'owner',
		});
		if (!parsed.success)
			return fail(400, { message: 'Informe um snapshot JSON e uma justificativa.' });
		let canonSnapshot: Record<string, unknown>;
		try {
			const decoded: unknown = JSON.parse(parsed.data.canonSnapshot);
			if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
				throw new Error('Expected a JSON object.');
			canonSnapshot = decoded as Record<string, unknown>;
		} catch {
			return fail(400, { message: 'O snapshot de cânone precisa ser um objeto JSON válido.' });
		}
		const { data: result, error: resultError } = await db
			.from('poll_results')
			.select('id,winner_option,verification_status')
			.eq('id', parsed.data.pollResultId)
			.eq('poll_id', parsed.data.pollId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (
			resultError ||
			!result ||
			result.verification_status !== 'VERIFIED' ||
			!result.winner_option
		)
			return fail(409, {
				message: 'A decisão exige o resultado verificado mais recente com vencedor.',
			});
		const { data: latest, error: latestError } = await db
			.from('poll_results')
			.select('id')
			.eq('poll_id', parsed.data.pollId)
			.eq('owner_id', owner.id)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (latestError || latest?.id !== result.id)
			return fail(409, { message: 'Registre primeiro a revisão de resultado mais recente.' });
		const { data: priorDecision, error: priorError } = await db
			.from('canonical_decisions')
			.select('id,revision_number')
			.eq('poll_id', parsed.data.pollId)
			.eq('owner_id', owner.id)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (priorError)
			return fail(503, { message: 'Não foi possível carregar o histórico de decisões.' });
		const { error: insertError } = await db.from('canonical_decisions').insert({
			owner_id: owner.id,
			poll_id: parsed.data.pollId,
			episode_id: event.params.episodeId,
			poll_result_id: result.id,
			revision_number: (priorDecision?.revision_number ?? 0) + 1,
			canon_snapshot: canonSnapshot,
			rationale: parsed.data.rationale,
			accepted_by: owner.id,
			supersedes_decision_id: priorDecision?.id ?? null,
		});
		if (insertError)
			return fail(409, {
				message:
					'Não foi possível registrar a decisão. A história não foi alterada automaticamente.',
			});
		return { canonSaved: true };
	},
};
