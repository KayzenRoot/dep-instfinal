import { z } from 'zod';

export const episodeOutlineSchema = z.object({
	logline: z.string().trim().min(1).max(1_000),
	hook: z.string().trim().min(1).max(2_000),
	reveal: z.string().trim().min(1).max(2_000),
	cliffhanger: z.string().trim().min(1).max(2_000),
	choices: z
		.array(
			z.object({
				label: z.string().trim().min(1).max(180),
				consequence: z.string().trim().min(1).max(4_000),
			}),
		)
		.length(2),
});

export type EpisodeOutline = z.infer<typeof episodeOutlineSchema>;
export type ProviderStatus = 'NOT_CONFIGURED' | 'READY' | 'ERROR';

export interface TextProvider {
	readonly name: string;
	status(): Promise<ProviderStatus>;
	generateOutline(input: {
		premise: string;
		episodeNumber: number;
		tone: string;
	}): Promise<EpisodeOutline>;
}

/** No provider is silently enabled. The hand-authored editor remains the default workflow. */
export class ManualTextProvider implements TextProvider {
	readonly name = 'manual';
	async status(): Promise<ProviderStatus> {
		return 'NOT_CONFIGURED';
	}
	async generateOutline(): Promise<EpisodeOutline> {
		throw new Error('Text generation is not configured. Continue in the manual editor.');
	}
}

export function createTextProvider(): TextProvider {
	return new ManualTextProvider();
}
