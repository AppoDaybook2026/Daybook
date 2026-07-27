# Daybook — état du projet

Document de reprise. À lire en premier dans toute nouvelle conversation.

---

## En une phrase

Application web (PWA) de suivi de la recherche doctorale : tâches
quotidiennes, jalons de thèse, et surtout un tableau de bord des appels à
communications et candidatures. Multi-utilisateurs, chiffrée de bout en bout,
synchronisée entre appareils. Trois langues : anglais, français, arabe.

## Adresses et comptes

| Quoi | Où |
|---|---|
| Application en ligne | https://daybook-5ak.pages.dev |
| Dépôt | https://github.com/AppoDaybook2026/Daybook |
| Hébergement | Cloudflare **Pages**, projet `daybook-5ak` |
| Base + auth | Supabase, projet `qowowtccxoelqiexaneq` |
| Modèle d'extraction | Google Gemini (`gemini-3.5-flash`, Interactions API) |
| Dossier local | `C:\Users\appol\Desktop\daybook` |

L'ancien déploiement Cloudflare **Workers** a été supprimé : il exposait le
nom de l'utilisateur dans l'URL.

## Architecture

**Frontend** — React + TypeScript + Vite, base locale Dexie (IndexedDB).
Toute la navigation est en mémoire : aucune route côté URL, donc pas besoin
de repli SPA côté serveur.

**Serveur** — Cloudflare Pages Functions dans `functions/api/`, logique
partagée dans `shared/extract.ts`. Deux routes : `/api/extract-event` et
`/api/health`.

**Chiffrement** — deux couches distinctes, à ne pas confondre :
- `localCrypto.ts` chiffre les champs libres au repos dans IndexedDB, avec une
  clé propre à l'appareil.
- `vault.ts` gère la clé de données (DEK) chiffrée sous la phrase de coffre et
  sous une phrase de récupération de 12 mots. C'est elle qui protège ce qui
  part vers Supabase.

**Synchronisation** — `sync.ts`. Chaque mutation locale est mise en file dans
`outbox`, poussée sous forme de blob AES-GCM opaque, puis récupérée par
curseur `updated_at`. Résolution de conflits au dernier écrivain, sur
`modifiedAt` transporté *dans* la charge chiffrée.

**Rappels** — `pg_cron` appelle chaque heure une fonction Edge Supabase
(`send-reminders`), qui n'envoie une notification qu'aux utilisateurs dont
l'heure locale est 9 h, 15 h ou 21 h. La charge utile est **vide** : le texte
affiché est composé par le service worker, dans la langue de l'utilisateur.

## Ce qui est vérifié, et comment

- **Isolation entre comptes** — `npm run test:rls` contre la vraie base.
  8 contrôles au vert : lecture croisée, écriture forgée, modification,
  suppression, accès anonyme, intégrité après attaques.
- **Synchronisation multi-appareils** — prouvée lors du changement de domaine :
  la nouvelle adresse était une base locale vierge, tout est revenu après
  connexion et déverrouillage du coffre.
- **Rappels serveur** — chaîne complète cron → fonction Edge → navigateur,
  après correction de l'URL du cron.
- **Suite automatisée** — 17 tests (`npm test`) : chiffrement, phrases de
  récupération, outbox, report des tâches, sauvegardes chiffrées, suivi v9.

## Variables d'environnement

Sur Cloudflare Pages, les quatre sont disponibles **à la compilation et à
l'exécution**, y compris chiffrées (vérifié).

| Nom | Nature |
|---|---|
| `VITE_SUPABASE_URL` | publique |
| `VITE_SUPABASE_ANON_KEY` | publique |
| `VITE_VAPID_PUBLIC_KEY` | publique |
| `GEMINI_API_KEY` | **secret** — sans préfixe `VITE_`, sinon exposée au navigateur |

## Pièges rencontrés — à ne pas réapprendre

**pdf.js vide le tableau d'octets.** `getDocument({ data })` transfère le
tableau à son sous-processus ; l'original tombe à zéro octet. Il faut lui
passer une copie (`bytes.slice()`), sinon le repli « envoyer le PDF au
serveur » expédie un fichier vide.

**Le service worker avale les routes serveur.** Sans
`navigateFallbackDenylist: [/^\/api\//]`, ouvrir `/api/health` dans la barre
d'adresse affiche l'application au lieu de la réponse du serveur, ce qui rend
tout diagnostic trompeur.

**Un fichier absent doit répondre 404.** Le repli « application monopage »
renvoyait `index.html` pour tout asset manquant, transformant une erreur de
déploiement en message incompréhensible sur le type MIME.

**`_redirects` avec `/* /index.html 200` est refusé** par le validateur
Cloudflare (boucle infinie). Inutile ici de toute façon.

**Les clés Gemini ont changé de format.** Celles en `AQ.Ab...` sont les
nouvelles clés d'autorisation ; les `AIza` sont retirées en septembre 2026.
Le modèle actuel est `gemini-3.5-flash` sur `/v1beta/interactions`.

**Brave bloque les notifications push** par défaut. Réglage à activer :
`brave://settings/privacy` → « Use Google services for push messaging », puis
redémarrage. Sans quoi : `Registration failed - push service error`.

**Vérifier le déployé, pas le local.** Plusieurs faux diagnostics ont été
évités en lisant la feuille de styles ou le bundle réellement servis. Attention
au cache : ajouter `?v=1` à l'URL pour contourner.

## Ce qui reste

- Message d'aide pour les utilisateurs de Brave, en trois langues.
- Domaine personnalisé, si `.pages.dev` finit par gêner.
- Palette : l'utilisateur trouve le nouveau sarcelle très discret, à réévaluer
  à l'usage.
- Page Quotidien et page Jalons : harmonisées visuellement, mais leur
  structure n'a pas été repensée comme celle des Échéances.

## Commandes utiles

```bash
npm install
npm run dev            # développement local
npm test               # 17 tests
npm run build          # tsc + vite + service worker
npm run test:rls       # isolation entre comptes (variables d'env requises)
```

Déploiement : automatique à chaque `git push origin main`.
