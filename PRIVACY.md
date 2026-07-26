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
