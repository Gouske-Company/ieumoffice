# Modèles IA et paramètres

## Où se trouvent les réglages

Ouvrez **Paramètres** depuis la ligne en bas à gauche de l’accueil et choisissez **IA**. Ce que vous voyez d’abord est la connexion par abonnement. La plupart des gens n’ont besoin de rien d’autre, et elle a son propre article : [Connexion par abonnement](help://subscription).

Tout ce qui demande une clé se trouve sous **Avancé**, en bas de la même page. Cette partie reste repliée tant que vous ne l’ouvrez pas.

## Par défaut : votre abonnement

- **IA à utiliser** est réglé au départ sur **Automatique** : parmi les abonnements connectés, d’abord Claude, puis ChatGPT, puis Codex.
- Automatique ne choisit jamais rien qui coûte de l’argent en plus. Une clé API ne sert que tant que vous choisissez vous-même ce fournisseur sous **IA à utiliser**.
- La liste des modèles en bas de chaque panneau IA montre d’abord les abonnements, puis les fournisseurs à clé dont vous avez terminé la configuration. Sous un abonnement, **Modèle par défaut** est le modèle standard de cet abonnement.

## Clés API (Avancé ▸ Modèle IA)

Pour ceux qui préfèrent payer directement un fournisseur, ou faire tourner leur propre modèle.

- Choisissez un **Fournisseur**, saisissez sa **Clé API** (et une **Base URL** lorsque le fournisseur en demande une), choisissez un **Modèle**, puis appuyez sur **Enregistrer**. La liste comprend les serveurs compatibles OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud et d’autres.
- Ici, la liste **Fournisseur** décide seulement des champs qui s’affichent. Elle ne change pas l’IA utilisée ; c’est toujours **IA à utiliser** qui en décide. Si un fournisseur enregistré n’est pas l’IA utilisée, **Utiliser cette IA** apparaît en haut ; un clic le choisit comme **IA à utiliser**.
- Les conversations avec un fournisseur à clé utilisent votre propre clé, et ce fournisseur vous les facture.
- Les clés sont stockées dans le fichier de paramètres de l'application sur cet ordinateur et envoyées uniquement dans les en-têtes de requête.
- **Tester la connexion** : vérifie que le point de terminaison est joignable et que le modèle est visible avant d’enregistrer.
- Les URL de base peuvent porter un chemin et une chaîne de requête (style passerelle) ; les chemins de point de terminaison sont concaténés correctement.
- Pour les serveurs que vous faites tourner vous-même, plusieurs **points de terminaison** peuvent être enregistrés, et vous passez de l’un à l’autre à tout moment.
- **Exécutable Codex** ne sert que pour un programme Codex installé à un endroit inhabituel. Laissez le champ vide et le programme est trouvé automatiquement.

## Quelle fonction a besoin de quoi

| Fonction                                                  | Ce qui la fait fonctionner                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation et modification dans le panneau IA           | Votre abonnement, ou un fournisseur à clé que vous avez choisi vous-même.                                                                                                                                                                                                                                                                                                                                     |
| Comprendre une image                                      | L’IA avec laquelle vous conversez regarde elle-même l’image. Aucune clé supplémentaire n’est nécessaire. Un fournisseur d’analyse distinct peut être choisi sous Avancé.                                                                                                                                                                                                                                      |
| Générer une image                                         | **Avec votre abonnement Codex connecté.** Si vous choisissez un fournisseur d’images sous Avancé ▸ Médias IA et recherche, il passe en premier. Si celui choisi n’est pas utilisable, ce qui l’est parmi l’abonnement Codex et vos fournisseurs configurés prend le relais. Sans l’un ni l’autre, la génération d’images est indisponible, et Slides utilise à la place des images trouvées par la recherche. |
| Analyse vidéo et audio                                    | Un fournisseur à clé qui prend en charge la vidéo, choisi sous Avancé ▸ Médias IA et recherche.                                                                                                                                                                                                                                                                                                               |
| Recherche web et d’images, lecture d’une page par adresse | Gratuite par défaut, sans clé. La clé d’un fournisseur de recherche est facultative.                                                                                                                                                                                                                                                                                                                          |
| Recherche dans vos propres fichiers                       | S’exécute sur cet ordinateur. Le reclassement des résultats par un service est facultatif et désactivé par défaut.                                                                                                                                                                                                                                                                                            |

Sous **Avancé ▸ Médias IA et recherche**, la clé et l’URL de base d’un fournisseur sont saisies une seule fois et partagées par toutes les fonctions qui utilisent ce fournisseur.

## Quand les changements s’appliquent

- Les changements de modèle et de point de terminaison s’appliquent immédiatement ; une conversation en cours conserve l’ancienne configuration jusqu’à son tour suivant.
