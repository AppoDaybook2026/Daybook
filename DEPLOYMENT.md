# Daybook — Guide de déploiement public (100 % gratuit)

Architecture : frontend statique sur **Cloudflare Pages** (avec une Pages
Function servant de proxy d'import d'URL), authentification et stockage
chiffré sur **Supabase**, rappels génériques via **pg_cron + Edge Function +
Web Push (VAPID)**. Coût : 0 €.

## 1. Créer le projet Supabase

1. Créez un compte sur https://supabase.com puis un projet (plan Free).
2. Dans **SQL Editor**, exécutez `supabase/migrations/0001_init.sql`.
3. Dans **Authentication → Sign In / Up** : laissez « Email » activé avec
   « Confirm email » coché (vérification d'adresse obligatoire).
4. Dans **Authentication → URL Configuration** : renseignez votre future URL
   publique (ex. `https://daybook.pages.dev`) comme *Site URL* et dans les
   *Redirect URLs*.
5. (Recommandé pour une app publique) **Authentication → SMTP** : branchez un
   SMTP externe gratuit (ex. Resend, 3 000 e-mails/mois) — le SMTP intégré est
   limité à quelques e-mails par heure.
6. Notez dans **Settings → API** : l'URL du projet et la clé `anon public`.

## 2. Clés Web Push (VAPID)

```bash
npx web-push generate-vapid-keys
```

Conservez la clé publique pour le frontend ; la clé privée servira uniquement
de secret à la fonction Edge (jamais dans le code ni dans `.env`).

## 3. Fonction Edge des rappels

```bash
npm i -g supabase
supabase login
supabase link --project-ref <PROJECT-REF>
supabase functions deploy send-reminders --no-verify-jwt
supabase secrets set \
  VAPID_PUBLIC_KEY=<publique> \
  VAPID_PRIVATE_KEY=<privée> \
  VAPID_SUBJECT=mailto:vous@exemple.com \
  CRON_SECRET=<chaîne-aléatoire-longue>
```

Puis exécutez `supabase/migrations/0002_reminders_cron.sql` dans le SQL Editor
après avoir remplacé `<PROJECT-REF>` et `<CRON-SECRET>`. La fonction tourne
toutes les heures et n'envoie une notification qu'aux utilisateurs dont
l'heure locale est 09 h, 15 h ou 21 h. Le payload est vide : le service
worker affiche un texte générique, sans aucune donnée privée.

## 4. Déployer sur Cloudflare Pages

1. Poussez le dépôt sur GitHub.
2. Sur https://dash.cloudflare.com → **Workers & Pages → Create → Pages →
   Connect to Git**, sélectionnez le dépôt.
3. Réglages de build : commande `npm run build`, dossier de sortie `dist`.
4. Variables d'environnement (Production) :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`
5. Déployez. Le dossier `functions/` est publié automatiquement comme Pages
   Functions (`/api/fetch-page`), et `public/_headers` applique HSTS + CSP.

## 5. Vérifications après déploiement

```bash
# Tests unitaires (chiffrement, outbox, sauvegardes)
npm test

# Isolation RLS entre deux comptes réels (créez 2 comptes de test d'abord)
SUPABASE_URL=... SUPABASE_ANON_KEY=... \
USER_A_EMAIL=... USER_A_PASSWORD=... \
USER_B_EMAIL=... USER_B_PASSWORD=... \
npm run test:rls
```

Parcours manuel : créer un compte → confirmer l'e-mail → se connecter →
créer le coffre → noter la phrase de 12 mots → importer l'espace local →
vérifier dans Supabase (Table Editor) que `records.payload` ne contient que du
`enc:v2:...` illisible → ouvrir l'app sur un second appareil → déverrouiller
avec la phrase → vérifier la synchronisation dans les deux sens → activer les
rappels et vérifier la réception d'une notification générique.

## 6. Limites du plan gratuit

- Supabase Free : 500 Mo de base, pause après 7 jours sans requête (le cron
  horaire des rappels maintient le projet actif) ; passez au plan Pro si
  l'application devient critique.
- Cloudflare Pages Free : 100 000 requêtes de Functions/jour (le proxy
  d'import), statique illimité.
- Web Push sur iOS : nécessite iOS 16.4+ et l'ajout de la PWA à l'écran
  d'accueil.
