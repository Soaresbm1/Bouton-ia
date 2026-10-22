# Bouton IA pour les entraînements Moodle

Extension Chrome / Edge qui lit les questions de la page Moodle, demande une réponse à Groq ou OpenAI et remplit les champs. Réservée aux entraînements où l’utilisation de l’IA est autorisée. Elle ne clique jamais sur les boutons de soumission ou de navigation Moodle.

## Installer dans Chrome ou Edge

1. Téléchargez ce dépôt et décompressez-le sur votre ordinateur.
2. Ouvrez la page des extensions : `chrome://extensions` ou `edge://extensions`.
3. Activez le **Mode développeur**, puis **Charger l’extension non empaquetée**.
4. Sélectionnez le dossier `extension` de ce projet. Aucune compilation nécessaire.
5. Ouvrez les options de l’extension depuis sa fiche, choisissez **Groq** ou **OpenAI**, puis renseignez la clé du fournisseur sélectionné et enregistrez. Le modèle proposé est `llama-3.3-70b-versatile` pour Groq et `gpt-4.1-mini` pour OpenAI. Vous pouvez saisir un autre modèle compatible avec Chat Completions et le mode JSON si nécessaire.

Créez votre clé depuis [GroqCloud](https://console.groq.com/keys) ou [OpenAI](https://platform.openai.com/api-keys). Le palier gratuit Groq dépend des modèles et quotas de votre compte ; les limites peuvent évoluer. Un abonnement ChatGPT ne comprend pas de crédit API OpenAI. Ne partagez jamais la clé dans le dépôt ou dans une conversation. La génération nécessite une clé avec un quota disponible.

Si un modèle est introuvable, ouvrez les options et cliquez sur **Charger les modèles disponibles** après avoir saisi votre clé. L’extension interroge directement l’API `/models` du fournisseur sélectionné, sans transmettre la clé ailleurs. Choisissez un modèle de conversation dans la liste puis cliquez sur **Enregistrer**. Les modèles de reconnaissance audio, de voix, d’embeddings et de sécurité identifiables par leur nom sont exclus de cette liste. La liste est celle renvoyée par le fournisseur ; elle ne garantit pas l’accès à une génération ni la compatibilité JSON de chaque modèle.

### Mettre à jour une ancienne version

Téléchargez de nouveau le dépôt et décompressez-le. Vous pouvez remplacer les fichiers de votre ancien dossier par ceux de la nouvelle version, puis cliquer sur **Recharger** dans la fiche de l’extension sur `edge://extensions`. Si vous utilisez un nouveau dossier, supprimez l’ancienne extension et chargez le nouveau dossier `extension`. La version affichée doit être **0.2.2**. Acceptez l’autorisation d’accès à `api.groq.com` si le navigateur la demande. Ouvrez les options, choisissez **Groq**, saisissez votre clé et enregistrez. Rechargez la page Moodle avant de relancer l’extension.

## Utilisation

1. Ouvrez un test d’entraînement Moodle avec ses questions affichées.
2. Cliquez sur l’icône de l’extension dans la barre du navigateur pour afficher le bouton sur cette page.
3. Cochez la confirmation que l’IA est autorisée, puis **Demander et remplir**.
4. Vérifiez les réponses et les explications avant de valider vous-même dans Moodle.

Après un changement de page, cliquez à nouveau sur l’icône. Les questions des autres pages ne sont pas traitées. Un nouveau clic sur « Demander et remplir » peut remplacer les réponses déjà saisies et entraîne une nouvelle requête API.

Formats pris en charge : choix unique, choix multiple, vrai/faux (boutons radio Moodle), réponse courte et texte à trous avec plusieurs champs texte ou numériques dans la même question (y compris les champs intégrés dans l’énoncé). Chaque trou est repéré par un identifiant pour associer la réponse au bon champ ; une liste incomplète ou invalide est refusée. Les appariements, menus déroulants, glisser-déposer et rédactions ne sont pas traités. Les images ne sont pas envoyées : seul leur texte alternatif est transmis. Les exercices nécessitant une image sans description suffisante peuvent rester sans réponse. Les réponses d’IA peuvent être incorrectes et les questions liées à un cours absent peuvent rester sans réponse.

Les QCM personnalisés intégrés dans une activité Page Moodle (`mod/page/view.php`) sont aussi détectés quand leur contenu principal comporte un titre HTML « Question 1 », « Question 2 », etc., suivi de l’énoncé et des champs. Les libellés peuvent être associés aux cases ou écrits directement après elles. Aucun clic sur « Corriger » n’est effectué. Si le minuteur remplace la question, ses choix ou ses champs pendant la requête IA, le remplissage de cette réponse est annulé : relancez sur la nouvelle question. L’extension ne suspend pas le minuteur. Cette détection est vérifiée sur des pages simulées, pas encore sur le DOM réel de Moodle S2 ; les exercices dans une iframe ne sont pas pris en charge.

## Données et permissions

L’accès à la page est accordé par votre clic sur l’icône (`activeTab`). Aucun accès général à tous vos sites n’est demandé. Les énoncés, les choix et les textes alternatifs des images des questions prises en charge sont envoyés directement à `api.groq.com` si Groq est choisi, ou `api.openai.com` si OpenAI est choisi, uniquement sur demande. La clé de chaque fournisseur reste séparée et n’est envoyée qu’à son propre service. Les cookies Moodle et les mots de passe ne sont pas collectés. Ne lancez pas l’outil si les énoncés contiennent des informations que vous n’êtes pas autorisé à transmettre.

La clé est conservée dans `chrome.storage.session`, accessible aux pages de confiance de l’extension, pas au script de page Moodle. Elle n’est ni écrite dans le stockage local persistant ni synchronisée. Après un redémarrage du navigateur ou un rechargement de l’extension, saisissez-la à nouveau. Le fournisseur et les noms des modèles sont enregistrés durablement. Aucun serveur intermédiaire n’est nécessaire.

## Développement et vérification

Node.js 22 ou supérieur :

```sh
npm ci
npm test
```

Chargez ensuite le dossier `extension` dans Chrome/Edge. Après une modification, rechargez l’extension depuis la page des extensions et rechargez la page Moodle.

Les tests automatisés utilisent des pages Moodle simulées et des réponses API simulées : extraction, remplissage, événements, absence de soumission, refus des réponses invalides, interface et erreurs API. Ils ne prouvent pas la compatibilité avec un thème Moodle particulier ou la disponibilité d’un modèle sur votre compte. Une vérification sur votre Moodle et un appel API réel restent nécessaires.
