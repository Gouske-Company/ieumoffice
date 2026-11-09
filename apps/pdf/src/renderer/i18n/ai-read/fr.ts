import type { zh } from './zh'

export const fr = {
  arButton: 'Lecture IA des pages',
  arButtonTip:
    "Faire lire par l'IA, à partir de leur image, les pages numérisées ou illisibles et conserver le résultat",
  arMenuRead: "Lire des pages avec l'IA…",
  arMenuDelete: "Supprimer les résultats d'IA conservés pour ce document…",
  arTitle: "Lire des pages avec l'IA",
  arIntro:
    "Chaque page choisie est envoyée à l'IA sous forme d'image, une page à la fois, pour en lire le texte, les tableaux et les formules. Le résultat est conservé sur ce PC et sert à la conversion Markdown et EPUB, à la fenêtre IA et à la recherche.",
  arAnalyzing: 'Analyse du document…',
  arAnalyzingProgress: 'Analyse du document… page {done} sur {total}',
  arAnalyzeFailed: "Le document n'a pas pu être analysé.",
  arPreselectNote:
    "Les pages numérisées, les pages dont le texte ne peut pas être lu correctement et les pages dont les notes n'ont pas pu être reliées sont déjà choisies. Ajoutez vous-même les pages avec des tableaux ou des formules.",
  arNoPreselect: "Aucune page n'a été présélectionnée. Ajoutez vous-même les pages à lire.",
  arReasonScanned: 'numérisée',
  arReasonDegraded: 'texte illisible',
  arReasonFootnote: 'notes non reliées',
  arReasonAdded: 'ajoutée par vous',
  arAlreadyRead: 'déjà lue · ignorée',
  arPageLabel: 'Page {page}',
  arAddLabel: 'Ajouter des pages',
  arAddPlaceholder: 'p. ex. 3, 7-9',
  arAdd: 'Ajouter',
  arSelectedCount: 'Pages choisies : {count}',
  arNext: 'Suivant',
  arBack: 'Retour',
  arCancel: 'Annuler',
  arStart: 'Démarrer',
  arConfirmTitle: 'Vérifiez avant de démarrer',
  arConfirmCalls: "Appels à l'IA : {calls} (un par page)",
  arConfirmSkipped: 'Pages déjà lues, non envoyées : {count}',
  arConfirmProvider: 'IA utilisée : {provider}',
  arConfirmPaid: '{provider} facturera ce service',
  arConfirmSends: 'Les images des pages sont envoyées à cette IA.',
  arConfirmNothing: "Toutes les pages choisies ont déjà été lues. Il n'y a rien à envoyer.",
  arChecking: "Vérification de la connexion à l'IA…",
  arProviderLabel: 'Fournisseur',
  arProviderNotConnected: '{provider} (non connecté)',
  arVisionProvider:
    '{provider} ne lit pas les images : la lecture IA des pages ne peut pas démarrer. Choisissez dans les Paramètres une IA qui lit les images.',
  arVisionModel:
    'Le modèle choisi ({model}) ne lit pas les images : la lecture IA des pages ne peut pas démarrer. Choisissez dans les Paramètres un modèle qui lit les images.',
  arVisionUnknown: "L'IA à utiliser n'a pas pu être déterminée : impossible de démarrer.",
  arRouteChanged:
    "La connexion à l'IA a changé. Vérifiez à nouveau les informations, puis démarrez.",
  arRunning: "L'IA lit les pages… {done} sur {total}",
  arRunningPage: 'lecture de la page {page}',
  arStop: 'Arrêter',
  arStopping: 'Arrêt…',
  arDone: 'Lecture IA terminée. Pages lues : {count}.',
  arFailedPages: 'Pages non lues : {pages}',
  arStoppedCancelled:
    'Lecture IA arrêtée. Les pages déjà lues sont conservées et vous pourrez continuer plus tard.',
  arStoppedFailures:
    "Lecture IA arrêtée après plusieurs échecs d'appel consécutifs. Les pages déjà lues sont conservées.",
  arStoppedStore:
    "Lecture IA arrêtée : le résultat n'a pas pu être conservé. Le disque est peut-être plein.",
  arLostPages: 'Pages reçues mais non conservées : {pages}',
  arStoppedError: 'Lecture IA arrêtée : {reason}',
  arStartFailed: "La lecture IA n'a pas pu démarrer : {reason}",
  arClose: 'Fermer',
  arBusy:
    "Une tâche IA est déjà en cours sur ce document ({done}/{total}). Réessayez lorsqu'elle sera terminée ou arrêtée.",
  arUnavailable: "La lecture IA des pages n'est pas disponible dans cette fenêtre.",
  arDeleteConfirm:
    'Supprimer tous les résultats IA conservés pour ce document (lectures IA, traductions, fiches de passage, suggestions de surlignage et aperçu) ? Cette action est irréversible.',
  arDeleted: "Les résultats d'IA conservés pour ce document ont été supprimés.",
  arDeleteFailed: "Les résultats d'IA conservés n'ont pas pu être supprimés.",
  arDeleteBusy: 'Une tâche IA est en cours : rien ne peut être supprimé pour le moment.',
  jobResumeAiRead: 'Lecture IA inachevée {percent} % — continuer ?',
  jobResumeTranslate: 'Traduction inachevée ({language}) {percent} % — continuer ?',
  jobResumeHighlight: 'Surlignage IA inachevé {percent} % — continuer ?',
  arDeleteAlsoBoth:
    'Seront aussi supprimées : les traductions corrigées à la main ({edited}) et les fiches de passage ({cards}).',
  arDeleteAlsoEdited: 'Seront aussi supprimées : les traductions corrigées à la main ({count}).',
  arDeleteAlsoCards: 'Seront aussi supprimées : les fiches de passage ({count}).',
  jobResumeContinue: 'Continuer',
  jobResumeLater: 'Plus tard',
  searchAiRead: "Trouvé dans le texte lu par l'IA",
  searchAiReadTip: "Le texte lu par l'IA n'a pas de position : on va seulement à la page",
} satisfies Record<keyof typeof zh, string>
