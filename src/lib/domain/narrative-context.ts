export type ChoiceContext = {
	optionKey: '1' | '2';
	label: string;
	consequence: string;
};

export type NarrativeEpisodeInput = {
	id: string;
	seasonNumber: number;
	seasonTitle: string;
	episodeNumber: number;
	title: string;
	status: string;
	durationMs: number;
	logline: string;
	hook: string;
	narrative: string;
	reveal: string;
	cliffhanger: string;
	narrationPtBr: string;
	scenes: Array<Record<string, unknown>>;
	choices: ChoiceContext[];
	poll: {
		status: string;
		latestResult: {
			id: string;
			option1Count: number;
			option2Count: number;
			winnerOption: '1' | '2' | null;
			verificationStatus: string;
			evidenceSource: string;
		} | null;
		latestDecision: {
			id: string;
			pollResultId: string;
			canonSnapshot: Record<string, unknown>;
			rationale: string;
		} | null;
	} | null;
};

export type NarrativeContextInput = {
	series: Record<string, unknown>;
	seasons: Array<Record<string, unknown>>;
	currentEpisode: {
		id: string;
		episodeNumber: number;
		seasonNumber: number;
		seasonTitle: string;
		title: string;
		durationSeconds: number;
		isSeasonFinale?: boolean;
	};
	characters: Array<Record<string, unknown>>;
	loreFacts: Array<Record<string, unknown>>;
	priorEpisodes: NarrativeEpisodeInput[];
};

export type CanonStatus =
	| 'APPROVED'
	| 'NO_POLL'
	| 'VOTE_OPEN'
	| 'POLL_CANCELLED'
	| 'POLL_NOT_VERIFIED'
	| 'RESULT_MISSING'
	| 'RESULT_UNVERIFIED'
	| 'NO_VERIFIED_WINNER'
	| 'OWNER_APPROVAL_PENDING'
	| 'STALE_DECISION';

export function getCanonStatus(poll: NarrativeEpisodeInput['poll']): {
	status: CanonStatus;
	approvedCanon: Record<string, unknown> | null;
} {
	if (!poll) return { status: 'NO_POLL', approvedCanon: null };
	if (poll.status === 'OPEN') return { status: 'VOTE_OPEN', approvedCanon: null };
	if (poll.status === 'CANCELLED') return { status: 'POLL_CANCELLED', approvedCanon: null };
	const result = poll.latestResult;
	if (!result) return { status: 'RESULT_MISSING', approvedCanon: null };
	if (result.verificationStatus !== 'VERIFIED')
		return { status: 'RESULT_UNVERIFIED', approvedCanon: null };
	if (poll.status !== 'VERIFIED') return { status: 'POLL_NOT_VERIFIED', approvedCanon: null };
	if (!result.winnerOption) return { status: 'NO_VERIFIED_WINNER', approvedCanon: null };
	const decision = poll.latestDecision;
	if (!decision) return { status: 'OWNER_APPROVAL_PENDING', approvedCanon: null };
	if (decision.pollResultId !== result.id) return { status: 'STALE_DECISION', approvedCanon: null };
	return {
		status: 'APPROVED',
		approvedCanon: {
			selectedOption: result.winnerOption,
			decisionSnapshot: decision.canonSnapshot,
			decisionRationale: decision.rationale,
			pollResultId: result.id,
			decisionId: decision.id,
		},
	};
}

export function buildNarrativeContext(input: NarrativeContextInput, branchOption?: '1' | '2') {
	const priorEpisodes = input.priorEpisodes.map((episode) => {
		const { status: canonStatus, approvedCanon } = getCanonStatus(episode.poll);
		const selectedOption = approvedCanon?.selectedOption;
		const selectedChoice =
			typeof selectedOption === 'string'
				? (episode.choices.find((choice) => choice.optionKey === selectedOption) ?? null)
				: null;
		return {
			...episode,
			canonStatus,
			approvedCanon: approvedCanon ? { ...approvedCanon, selectedChoice } : null,
		};
	});
	const latestPrevious = priorEpisodes.at(-1);
	const branchChoice = branchOption
		? latestPrevious?.choices.find((choice) => choice.optionKey === branchOption)
		: undefined;
	return {
		schemaVersion: 'dif-narrative-context/v1',
		preparedFor: input.currentEpisode,
		series: input.series,
		seasons: input.seasons,
		characters: input.characters,
		loreFacts: input.loreFacts,
		priorEpisodes,
		latestPreviousCanon: latestPrevious
			? {
					episodeId: latestPrevious.id,
					episodeTitle: latestPrevious.title,
					status: latestPrevious.canonStatus,
					approvedCanon: latestPrevious.approvedCanon,
				}
			: null,
		hypotheticalBranch: branchChoice
			? {
					status: 'HYPOTHETICAL_NOT_CANON',
					isCanon: false,
					fromEpisodeId: latestPrevious?.id,
					selectedOption: branchChoice.optionKey,
					label: branchChoice.label,
					consequence: branchChoice.consequence,
				}
			: null,
	};
}

export function estimateNarrationDurationSeconds(text: string, wordsPerMinute: number): number {
	const words = text.trim().split(/\s+/u).filter(Boolean).length;
	return wordsPerMinute > 0 ? Math.round((words / wordsPerMinute) * 60) : 0;
}

export function renderNarrativePrompt(
	context: ReturnType<typeof buildNarrativeContext>,
	wordsPerMinute: number,
) {
	const targetSeconds = context.preparedFor.durationSeconds;
	const targetWords = Math.round((targetSeconds * wordsPerMinute) / 60);
	return [
		'# DIF Studio · prompt manual de continuação narrativa',
		'',
		'Este arquivo não chama nenhum provedor de IA. Ele contém contexto privado para uso manual. Retorne somente um objeto JSON válido conforme o formato abaixo.',
		'',
		'## Regras de continuidade',
		'',
		'- Preserve personagens, estados, acontecimentos, pistas, regras, escolhas e consequências presentes no contexto.',
		'- Só considere definitivo um resultado cujo estado esteja `APPROVED`. Votação aberta, resultado pendente, decisão ausente ou revisão obsoleta não são cânone.',
		'- Se houver uma hipótese de ramo, ela está marcada `HYPOTHETICAL_NOT_CANON`; desenvolva apenas essa possibilidade para este rascunho e não a descreva como fato ocorrido.',
		'- Não invente votação, vencedor, consequência aprovada, personagem, regra ou fato ausente do contexto.',
		context.preparedFor.isSeasonFinale
			? '- Escreva em português brasileiro. Inclua gancho, escalada, revelação e encerramento; como este é o episódio final da temporada, não inclua opções de votação.'
			: '- Escreva em português brasileiro. Inclua gancho, escalada, revelação e cliffhanger; apresente duas opções genuinamente distintas com consequências diferentes.',
		'- A narração deve estimar de 90 a 150 segundos sem cortar acontecimentos essenciais. Use a velocidade informada e revise o texto completo até a estimativa corresponder à duração declarada.',
		'- Não altere o cânone: a resposta será importada como rascunho editável e só uma aprovação explícita pode registrar decisão canônica.',
		'',
		'## Alvo de duração',
		'',
		`Episódio: ${context.preparedFor.seasonNumber}.${context.preparedFor.episodeNumber} · ${context.preparedFor.title}`,
		`Duração desejada: ${targetSeconds} segundos; velocidade: ${wordsPerMinute} palavras por minuto; referência aproximada: ${targetWords} palavras narradas.`,
		'',
		'## Contexto canônico (JSON)',
		'',
		'```json',
		JSON.stringify(context, null, 2),
		'```',
		'',
		'## Formato obrigatório da resposta',
		'',
		'```json',
		JSON.stringify(
			{
				title: '',
				logline: '',
				hook: '',
				narrative: '',
				narrationPtBr: '',
				reveal: '',
				cliffhanger: '',
				durationSeconds: targetSeconds,
				speechSpeedWpm: wordsPerMinute,
				screenSuggestion: '',
				soundSuggestion: '',
				coverText: '',
				tiktok: { title: '', cta: '', description: '' },
				instagram: { title: '', cta: '', description: '' },
				choices: context.preparedFor.isSeasonFinale
					? []
					: [
							{ label: '', consequence: '' },
							{ label: '', consequence: '' },
						],
			},
			null,
			2,
		),
		'```',
		'',
		context.preparedFor.isSeasonFinale
			? 'Importe o objeto no editor DIF Studio. Este episódio final pode usar choices vazio; a validação confere os campos narrativos e a estimativa de duração antes de salvar o rascunho.'
			: 'Importe o objeto no editor DIF Studio. A validação confere campos, duas opções distintas e estimativa de duração antes de salvar o rascunho.',
		'',
		'',
	].join('\n');
}
