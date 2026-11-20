# Jobseeker

Alex's personal job-search tracker. Same principle as Loopforce and Loopline:
its own Worker, its own D1 database, its own repo, Loopwrk visual language.
**Workers Free plan only** — no paid Cloudflare service, nothing to pay.

## How it works

- A Claude scheduled task ("Jutarnji agent za poslove (računar)", weekdays 7:43
  Belgrade time, runs on Alex's Mac) finds remote jobs, verifies each posting is
  live on the employer's own page, writes them into **D1 directly** through the
  Cloudflare D1 connector, updates statuses from Gmail, re-checks open postings,
  prepares application packages and Gmail follow-up drafts. It never sends
  anything and never applies.
- A second scheduled task at 9:17 pushes a reminder if the morning run did not
  happen (Mac asleep / Claude app closed).
- This app is where Alex reviews, edits and moves jobs through the pipeline.
  There is no public API: the only writers are the logged-in user and the agent
  via the D1 connector.

## Stack

Hono on Cloudflare Workers (server-rendered `hono/jsx`), Cloudflare D1, Workers
Static Assets (`public/`), WebCrypto PBKDF2 passwords + `HttpOnly` session
cookie, login lockout after 5 failed attempts. Shared `style.css` with
Loopforce; Jobseeker-only styles in `public/jobseeker.css`.

## Pages

- **Pregled** — status tiles, ready packages, jobs to review, follow-ups due, last agent run.
- **Poslovi** — table or board, filter by status / level (Head/Senior, Mid), sort, search.
- **Posao** — status, details, application package (cover letter, CV bullets, form answers, copy buttons), history log, follow-up date, exclude / delete.
- **Izbačeni** — postings the agent must never bring back.
- **Agent** — every run with its summary and the "couldn't verify" list.
- **Profil i kriterijumi** — CV profile and search rules the agent reads before every run.

## Data model

`users`, `sessions`, `jobs`, `job_events` (append-only log), `packages`,
`excluded`, `agent_runs`, `app_settings` (`profile`, `criteria`). See
`migrations/0001_init.sql`.

## Databases

- Production: `jobseeker-db` (`bfde5052-b5ea-42d2-9fce-6cde4978c769`)
- Previews: `jobseeker-preview-db` (`74b8b710-14d3-41e5-b4d3-f1638e0bc190`)

Migration 0001 is already applied to both (and recorded in `d1_migrations`),
so `npm run db:migrate:remote` only applies newer ones.

## Deploy (one time)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository →
   `Loopwrk-Labs/Jobseeker`. Build command: none. Deploy command: `npx wrangler deploy`.
2. Settings → Variables and Secrets → add `SESSION_SECRET` (encrypted), any long random string.
3. Open the `*.workers.dev` URL → `/setup` → create your account (the screen disappears after that).

Rule (same as the website repo): changes go to a preview branch first;
production only when Alex says "push".

## Local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```
