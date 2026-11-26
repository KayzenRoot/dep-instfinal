export interface HelpEntry {
	title: string;
	description: string;
	steps?: string[];
	constraint?: string;
}

export const HELP_CATALOG = {
	privateStudio: {
		title: 'Estúdio privado',
		description:
			'O DIF Studio é um arquivo privado de séries, episódios e decisões de continuidade.',
		constraint:
			'O acesso é exclusivo do proprietário autenticado; dados e mídias não são publicados automaticamente. Publicação e exportação são manuais.',
	},
	dashboardSeries: {
		title: 'Séries',
		description:
			'Conta as séries visíveis neste arquivo privado, incluindo as que ainda estão em rascunho.',
		constraint: 'Não representa publicações, seguidores ou audiência externa.',
	},
	dashboardEpisodes: {
		title: 'Episódios',
		description: 'Soma os episódios de todas as temporadas das séries visíveis.',
		constraint: 'Episódios em rascunho também entram na contagem.',
	},
	openPolls: {
		title: 'Votações abertas',
		description: 'Mostra as votações de continuidade que ainda aguardam uma decisão registrada.',
		steps: [
			'Abra uma votação para revisar as escolhas.',
			'Registre a decisão manualmente quando o resultado estiver claro.',
		],
		constraint: 'O resultado nunca é aplicado ao cânone automaticamente.',
	},
	mediaAssets: {
		title: 'Quadros e mídias',
		description:
			'Conta os quadros e imagens privadas já vinculados ao arquivo (frames, capas e referências).',
		constraint:
			'Imagens ficam no Cloudinary privado; vídeos ficam no R2 privado e não entram nesta contagem.',
	},
	seriesTitle: {
		title: 'Título da série',
		description: 'Nome curto que identifica a série no arquivo e nas listas de produção.',
		constraint: 'Use até 120 caracteres e evite nomes duplicados.',
	},
	seriesPremise: {
		title: 'Premissa',
		description:
			'Resumo do mistério central e da promessa narrativa que orienta temporadas e episódios.',
		steps: [
			'Descreva o conflito principal em poucas frases.',
			'Registre o que permanece desconhecido para o público.',
		],
		constraint: 'A premissa orienta rascunhos; o cânone só muda com decisão explícita.',
	},
	seriesSubgenre: {
		title: 'Subgênero',
		description: 'Rótulo livre para organizar a série dentro do seu repertório.',
		constraint: 'Não é uma taxonomia fechada nem uma alegação de gênero de plataforma.',
	},
	seriesTone: {
		title: 'Tom',
		description: 'Referência criativa de atmosfera, ritmo e intensidade para a série.',
		constraint: 'Serve como orientação editorial; não gera conteúdo automaticamente.',
	},
	seriesAudience: {
		title: 'Público pretendido',
		description: 'Descreve para quem a história foi pensada e qual experiência se espera.',
		constraint: 'Não é uma métrica de audiência real nem previsão de alcance.',
	},
} as const satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof HELP_CATALOG;

export const HELP_KEYS = Object.keys(HELP_CATALOG) as HelpKey[];

export function getHelpEntry(key: HelpKey): HelpEntry {
	return HELP_CATALOG[key];
}
