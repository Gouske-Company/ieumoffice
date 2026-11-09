import type { zh } from './zh'

export const pt = {
  arButton: 'Leitura de páginas com IA',
  arButtonTip:
    'Fazer a IA ler, a partir da imagem, páginas digitalizadas ou ilegíveis e guardar o resultado',
  arMenuRead: 'Ler páginas com IA…',
  arMenuDelete: 'Excluir os resultados de IA guardados deste documento…',
  arTitle: 'Ler páginas com IA',
  arIntro:
    'Cada página escolhida é enviada à IA como imagem, uma de cada vez, para ler o texto, as tabelas e as fórmulas. O resultado fica guardado neste computador e é usado na conversão para Markdown e EPUB, na janela de IA e na pesquisa.',
  arAnalyzing: 'Analisando o documento…',
  arAnalyzingProgress: 'Analisando o documento… página {done} de {total}',
  arAnalyzeFailed: 'Não foi possível analisar o documento.',
  arPreselectNote:
    'As páginas digitalizadas, as páginas cujo texto não pode ser lido corretamente e as páginas cujas notas não puderam ser ligadas já estão escolhidas. Adicione você mesmo as páginas com tabelas ou fórmulas.',
  arNoPreselect:
    'Nenhuma página precisou ser pré-selecionada. Adicione você mesmo as páginas a ler.',
  arReasonScanned: 'digitalizada',
  arReasonDegraded: 'texto ilegível',
  arReasonFootnote: 'notas não ligadas',
  arReasonAdded: 'adicionada por você',
  arAlreadyRead: 'já lida · ignorada',
  arPageLabel: 'Página {page}',
  arAddLabel: 'Adicionar páginas',
  arAddPlaceholder: 'ex.: 3, 7-9',
  arAdd: 'Adicionar',
  arSelectedCount: 'Páginas escolhidas: {count}',
  arNext: 'Avançar',
  arBack: 'Voltar',
  arCancel: 'Cancelar',
  arStart: 'Iniciar',
  arConfirmTitle: 'Confira antes de iniciar',
  arConfirmCalls: 'Chamadas à IA: {calls} (uma por página)',
  arConfirmSkipped: 'Páginas já lidas, não enviadas: {count}',
  arConfirmProvider: 'IA usada: {provider}',
  arConfirmPaid: '{provider} cobrará por isto',
  arConfirmSends: 'As imagens das páginas são enviadas para esta IA.',
  arConfirmNothing: 'Todas as páginas escolhidas já foram lidas. Não há nada para enviar.',
  arChecking: 'Verificando a conexão com a IA…',
  arProviderLabel: 'Provedor',
  arProviderNotConnected: '{provider} (não conectado)',
  arVisionProvider:
    '{provider} não lê imagens, por isso a leitura de páginas com IA não pode começar. Escolha nas Configurações uma IA que leia imagens.',
  arVisionModel:
    'O modelo escolhido ({model}) não lê imagens, por isso a leitura de páginas com IA não pode começar. Escolha nas Configurações um modelo que leia imagens.',
  arVisionUnknown: 'Não foi possível determinar qual IA usar, por isso não é possível começar.',
  arRouteChanged: 'A conexão com a IA mudou. Confira os dados de novo e depois inicie.',
  arRunning: 'A IA está lendo as páginas… {done} de {total}',
  arRunningPage: 'lendo a página {page}',
  arStop: 'Parar',
  arStopping: 'Parando…',
  arDone: 'Leitura com IA concluída. Páginas lidas: {count}.',
  arFailedPages: 'Páginas não lidas: {pages}',
  arStoppedCancelled:
    'Leitura com IA interrompida. As páginas lidas ficaram guardadas e você pode continuar depois.',
  arStoppedFailures:
    'A leitura com IA parou porque várias chamadas seguidas falharam. As páginas lidas ficaram guardadas.',
  arStoppedStore:
    'A leitura com IA parou porque o resultado não pôde ser guardado. O disco pode estar cheio.',
  arLostPages: 'Páginas recebidas, mas não guardadas: {pages}',
  arStoppedError: 'A leitura com IA parou: {reason}',
  arStartFailed: 'Não foi possível iniciar a leitura com IA: {reason}',
  arClose: 'Fechar',
  arBusy:
    'Já há uma tarefa de IA em andamento neste documento ({done}/{total}). Tente de novo quando ela terminar ou for interrompida.',
  arUnavailable: 'A leitura de páginas com IA não está disponível nesta janela.',
  arDeleteConfirm:
    'Excluir todos os resultados de IA guardados deste documento (leituras com IA, traduções, cartões de trecho, sugestões de destaque e a visão geral)? Isso não pode ser desfeito.',
  arDeleted: 'Os resultados de IA guardados deste documento foram excluídos.',
  arDeleteFailed: 'Não foi possível excluir os resultados de IA guardados.',
  arDeleteBusy: 'Há uma tarefa de IA em andamento, por isso nada pode ser excluído agora.',
  jobResumeAiRead: 'Leitura com IA inacabada {percent}% — continuar?',
  jobResumeTranslate: 'Tradução inacabada ({language}) {percent}% — continuar?',
  jobResumeHighlight: 'Destaques com IA inacabados {percent}% — continuar?',
  arDeleteAlsoBoth:
    'Também serão excluídos: traduções corrigidas à mão ({edited}) e cartões de trecho ({cards}).',
  arDeleteAlsoEdited: 'Também serão excluídas as traduções corrigidas à mão ({count}).',
  arDeleteAlsoCards: 'Também serão excluídos os cartões de trecho ({count}).',
  jobResumeContinue: 'Continuar',
  jobResumeLater: 'Mais tarde',
  searchAiRead: 'Encontrado no texto lido pela IA',
  searchAiReadTip: 'O texto lido pela IA não tem posições, então só vai para a página',
} satisfies Record<keyof typeof zh, string>
