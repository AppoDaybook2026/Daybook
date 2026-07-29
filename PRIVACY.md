# Daybook — Confidentialité et sécurité

## Ce que le serveur peut voir

- Votre adresse e-mail et l'horodatage de vos synchronisations.
- Votre fuseau horaire et si les rappels sont activés.
- Des enregistrements chiffrés : identifiants aléatoires (UUID), nom de
  collection (« task », « milestone »…) et un bloc `enc:v2:...` illisible.

## Ce que le serveur ne peut PAS voir — par conception

- Le texte de vos tâches et notes, les intitulés de jalons et sous-activités,
  les noms, lieux, frais et sources de vos événements : tout est chiffré
  AES-GCM 256 dans votre navigateur AVANT envoi, avec un vecteur
  d'initialisation unique par valeur.
- La clé de chiffrement (DEK) : elle est générée sur votre appareil et n'est
  stockée côté serveur que sous forme enveloppée (chiffrée) par des clés
  dérivées (Argon2id) de votre phrase de coffre et de votre phrase de
  récupération de 12 mots. Ces phrases ne quittent jamais vos appareils.
- L'administrateur du service, l'hébergeur et le concepteur de l'application
  ne peuvent pas lire vos contenus, ni réinitialiser votre phrase de coffre.

## La seule exception : la rédaction assistée du rapport

Il existe un endroit, et un seul, où votre contenu sort du chiffrement de bout
en bout : le bouton **« Rédiger avec l'IA »** de la rubrique Rapport.

Si vous l'utilisez, sont envoyés à Google Gemini, en clair :

- les intitulés des tâches que vous avez accomplies sur la période choisie ;
- vos notes de travail attachées à ces tâches ;
- les titres de vos chapitres et l'état de leur avancement ;
- la liste de vos exigences et candidatures, avec leur statut.

Ne sont **jamais** envoyés : votre identité, votre page de garde, le titre de
votre thèse, le nom de vos encadrants, votre numéro d'étudiant, ni aucune
donnée hors de la période choisie.

L'application vous avertit explicitement avant chaque envoi, et vous pouvez
refuser : les huit sections restent alors entièrement rédigeables à la main,
et l'export Word fonctionne à l'identique. Tout le reste de l'application —
tâches, jalons, échéances, sauvegardes, synchronisation — demeure chiffré de
bout en bout, sans exception.

## Récupération

- Nouvel appareil : connexion + phrase de coffre (ou phrase de 12 mots).
- Mot de passe du compte oublié : réinitialisable par e-mail — cela ne touche
  pas au chiffrement.
- Phrase de coffre oubliée : récupérable uniquement avec les 12 mots.
- **Phrase de coffre ET 12 mots perdus : les données chiffrées sont
  définitivement irrécupérables. Aucune porte dérobée n'existe.**

## Notifications

Les rappels de 09 h, 15 h et 21 h sont envoyés avec un contenu vide ; le texte
affiché (« Vous avez des éléments à consulter dans Daybook ») est fixe et ne
contient jamais de donnée personnelle.

## Divers

- Mode local sans compte disponible : aucune donnée ne quitte l'appareil.
- L'extraction d'événements depuis un PDF est 100 % locale ; l'extraction
  depuis un lien passe par un proxy qui ne conserve rien.
- Aucune télémétrie, aucune analyse d'usage, aucune publicité.
- Les jetons d'authentification sont gérés par le SDK Supabase (PKCE).
- Sauvegardes exportées : fichiers JSON chiffrés par un mot de passe que vous
  choisissez ; sans lui, le fichier est illisible.
