import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { insertRow, ownerId } from './supabase.js';

export interface EpisodeFixtureInput {
	suffix: string;
	seriesTitle: string;
	premise: string;
	seasonTitle: string;
	plannedEpisodeCount: number;
	episodeNumber: number;
	episodeTitle: string;
	durationMs: number;
	token: string;
}

export async function insertEpisodeHierarchy(
	request: APIRequestContext,
	input: EpisodeFixtureInput,
): Promise<{ seriesId: string; seasonId: string; episodeId: string }> {
	const seriesId = crypto.randomUUID();
	const seasonId = crypto.randomUUID();
	const episodeId = crypto.randomUUID();
	await insertRow(request, input.token, 'series', {
		id: seriesId,
		owner_id: ownerId,
		title: input.seriesTitle,
		premise: input.premise,
	});
	await insertRow(request, input.token, 'seasons', {
		id: seasonId,
		owner_id: ownerId,
		series_id: seriesId,
		season_number: 1,
		title: input.seasonTitle,
		planned_episode_count: input.plannedEpisodeCount,
	});
	await insertRow(request, input.token, 'episodes', {
		id: episodeId,
		owner_id: ownerId,
		season_id: seasonId,
		episode_number: input.episodeNumber,
		title: input.episodeTitle,
		duration_ms: input.durationMs,
	});
	return { seriesId, seasonId, episodeId };
}

export async function loginAsOwner(page: Page): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('E-mail do proprietário').fill(process.env.E2E_OWNER_EMAIL!);
	await page.getByLabel('Senha').fill(process.env.E2E_OWNER_PASSWORD!);
	await page.getByRole('button', { name: 'Entrar no arquivo' }).click();
	await expect(page).toHaveURL(/\/app$/);
}
