# Daybook - Claude Handoff

## Objective

Turn the existing local-first Daybook application into a publicly accessible multi-user application. Users must be able to create accounts and have independent private workspaces. The application owner must not be able to read user content.

## Current application

- React, TypeScript, Vite and Tailwind CSS
- Dexie/IndexedDB local persistence
- PWA and offline support
- English-first UI with French and Arabic options, including RTL
- Daily tasks with carryover, priorities, ordering, timers, notes and historical calendar
- Dissertation milestones with subactivities and calculated progress
- Deadlines for publications, conferences and training
- Client-side PDF event extraction and URL extraction when CORS permits
- Local notifications at 09:00, 15:00 and 21:00 while the app is active
- New personal text is encrypted locally with Web Crypto before IndexedDB storage

## Required implementation

1. Preserve every existing feature and the current visual design.
2. Add account creation, sign-in, sign-out, email verification and password reset.
3. Use Supabase Auth and PostgreSQL, or an equivalently mature managed service.
4. Add strict row-level security to every table. Every record must carry `user_id`, and policies must restrict all reads and writes to `auth.uid() = user_id`.
5. Keep IndexedDB as the offline working store. Add an outbox/sync queue and conflict-safe synchronization when connectivity returns.
6. Implement client-side end-to-end encryption for task text, notes, milestone content, subactivities and event details before cloud synchronization.
7. Use a separate vault passphrase or recovery key that is never sent to the backend. Derive a key client-side with a strong KDF and use AES-GCM with a unique IV per value. The cloud must store ciphertext only.
8. Never store the raw encryption key, vault passphrase or decrypted content in logs, analytics, environment variables or the database.
9. Support multi-device use by storing only a wrapped data-encryption key. Require the vault passphrase or recovery key on a new device.
10. Clearly warn that losing the recovery key makes encrypted data unrecoverable. Do not add an owner-accessible recovery backdoor.
11. Provide a first-login choice to import the current IndexedDB workspace into the new encrypted account.
12. Keep an account-free local-only mode for users who do not want synchronization.
13. Add encrypted JSON backup and restore.
14. Implement generic Web Push reminders at 09:00, 15:00 and 21:00 without sending event names or private content to the notification server. The notification should only say that Daybook has an upcoming item to review.
15. Make PDF extraction remain fully client-side. Do not upload PDFs unless the user explicitly chooses to do so.
16. For URL extraction, use a narrowly scoped serverless proxy with SSRF protection, response size limits, HTML-only validation and rate limiting. Do not persist fetched pages.
17. Add automated tests for authentication boundaries, RLS policies, encryption round trips, offline synchronization and cross-user isolation.
18. Deploy the frontend to Vercel or Cloudflare Pages and configure HTTPS, security headers and environment variables.
19. Provide database migrations, `.env.example`, deployment instructions and a concise privacy/security document.

## Security acceptance criteria

- User A can never read or modify User B's rows through the UI or direct API requests.
- Database administrators see ciphertext for protected content.
- No plaintext personal content appears in network requests except transiently inside the user's browser before encryption.
- Encryption keys are non-exportable where practical and never transmitted unwrapped.
- Authentication tokens are handled by the provider SDK and are not stored manually in insecure browser storage.
- Content Security Policy, secure headers, dependency audit and input validation are enabled.
- The system contains no analytics or telemetry that captures task, note, milestone or event content.

## Working method

Inspect the repository before changing it. Implement incrementally. Do not replace the existing application with a generic dashboard. Preserve IndexedDB and the offline-first experience. Run the production build and tests after each major phase. Before deploying, show the proposed Supabase schema, RLS policies and encryption design for approval.

## Suggested deployment

- Frontend: Vercel or Cloudflare Pages
- Authentication/database: Supabase
- Generic scheduled push: Supabase Edge Functions plus a scheduler, or Cloudflare Workers plus Cron Triggers
- No private Daybook content may be included in push payloads or server logs
