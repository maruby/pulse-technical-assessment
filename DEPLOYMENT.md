# Pulse deployment guide

This project uses Next.js App Router, Vercel Node.js functions, Neon PostgreSQL, Prisma 7, Mapbox GL JS, short HTTP polling, and browser-to-browser WebRTC. It does not require a custom server, WebSocket service, Redis, or `vercel.json`.

## Required services

- **GitHub** repository connected to Vercel.
- **Neon PostgreSQL** database for Presence, signaling mailboxes, Signals, Waves, and safety records.
- **Mapbox** public access token for browser map rendering.
- **Vercel** project using Node.js 24.x.

## Environment variables

| Variable | Required | Use | Where it comes from |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Neon connection for application queries. Use the hostname containing `-pooler`. | Neon Console → project → Connect → enable pooled connection. |
| `DATABASE_URL_UNPOOLED` | For Prisma migrations | Direct Neon connection for migration and schema commands. It is not used for normal app queries. | Neon Console → project → Connect → disable pooled connection. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Public Mapbox token embedded in the browser bundle. | Mapbox Account → Access Tokens. |

`NEXT_PUBLIC_MAPBOX_TOKEN` is deliberately public; it must be a Mapbox `pk` token with only the public scopes needed to render maps (normally `styles:read` and `fonts:read`). Restrict it to the deployed domain(s) where possible. Never put database credentials, Mapbox secret (`sk`) tokens, or other secrets under a `NEXT_PUBLIC_` name. Mapbox documents public tokens and URL restrictions in its [token management guide](https://docs.mapbox.com/accounts/guides/tokens/).

For local Prisma CLI commands, put both Neon URLs in the ignored `.env` file. `prisma.config.ts` selects `DATABASE_URL_UNPOOLED` when present, and otherwise falls back to `DATABASE_URL`; use the direct URL for migrations. Do not paste connection strings into source files, commits, screenshots, or logs.

## Configure Neon

1. Create a Neon project and PostgreSQL database in a region near the Vercel function region you plan to use.
2. From **Connect**, copy the pooled connection string into `DATABASE_URL` and the direct connection string into `DATABASE_URL_UNPOOLED`. Both must target the same database and include TLS (`sslmode=require`). The application uses the pooled URL; Prisma migrations use the direct URL. See [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
3. Use a separate Neon branch/database for Vercel Preview deployments. Do not point unreviewed preview code at production data.
4. This repository already contains versioned migrations in `prisma/migrations`; keep them in source control. Do not use `prisma db push`, `--force-reset`, or `migrate reset` to initialize production.

## Configure Mapbox

1. In Mapbox, use or create a public `pk` token with map-rendering scopes; do not use a secret `sk` token in this client-side application.
2. Add URL restrictions for the Vercel production domain and any custom domain. If Preview deployments need maps, allow their preview domain pattern or use a separate public token for Preview.
3. The app reads `NEXT_PUBLIC_MAPBOX_TOKEN` in `WorldMap`. Next.js embeds `NEXT_PUBLIC_` values during the build, so changes require a new deployment. The code contains a placeholder fallback token; do not rely on it—configure the real token for every environment.

## Import the repository into Vercel

1. Sign in to Vercel, choose **Add New → Project**, connect GitHub if prompted, and import this repository. Vercel's [Git integration](https://vercel.com/docs/git) creates deployments from the configured production branch and preview deployments from other branches.
2. Keep the project root at the repository root and select the Next.js framework preset. Leave the install and output settings at their defaults. No `vercel.json` is required.
3. Set the Node.js version to **24.x** in **Settings → Build and Deployment → Node.js Version**. `package.json` also declares `24.x`; this meets the installed Prisma 7 engine requirement and is supported by Vercel ([supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)).
4. Add `DATABASE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN` under **Settings → Environment Variables** for Production. Add the corresponding Preview database URL and Mapbox token for Preview. `DATABASE_URL_UNPOOLED` is only needed in Vercel if you intentionally run Prisma CLI migrations from that environment; the recommended workflow below runs migrations separately with a local, ignored `.env`.
5. Vercel detects the standard Next.js build. `npm run build` already runs `npx prisma generate` before `next build`, so Prisma Client is generated during every build. The build does not apply database migrations.

All API routes explicitly use the Node.js runtime because they rely on Prisma's PostgreSQL driver adapter, Node crypto, and Buffer. Their short request/response handlers are compatible with Vercel functions. Polling remains ordinary HTTP requests backed by Postgres, so it does not depend on process-local state or a persistent server. WebRTC signaling is exchanged through those existing endpoints; chat and media use browser peer connections. No WebSocket connection is hosted by Vercel.

## Initialize the production database

Configure `.env` locally with the production `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from Neon. Keep `.env` uncommitted. From the repository root, first inspect migration status, then apply the committed migrations:

```bash
npx prisma migrate status
npx prisma migrate deploy
```

`migrate deploy` applies pending migrations from `prisma/migrations` and does not reset the database. Use it for a new, empty production database. If the database already contains tables created with `db push` or another migration history, stop and compare its schema and migration ledger before applying anything; it may need a carefully verified baseline. Never force-reset production. Prisma documents `migrate deploy` for Prisma ORM 7 in its [production migration guide](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).

After migration, deploy the application. If the migration command reports an existing migration is failed or the database schema differs from the repository, do not mark migrations applied or reset the database without first confirming the live schema and data.

## Deploy and redeploy

- With Git integration, push/merge to Vercel's configured Production Branch for a production deployment. Push another branch or open a pull request to receive a Preview deployment.
- For a manual CLI deployment after linking the project, run `npx vercel --prod` from the repository root. This command deploys; it is not required when using Git integration.
- When environment variables change, trigger a new deployment so the build receives them, especially for `NEXT_PUBLIC_MAPBOX_TOKEN`.
- Check the Vercel deployment's build and function logs after each deployment. Keep schema migration as a deliberate step before deploying code that requires the new schema; do not run migrations on every function startup.

## Test two-user connectivity

1. Open the production HTTPS URL in two independent browser profiles or browsers. Allow location access in both, and use separate mock locations in browser developer tools if the users are not physically nearby.
2. Confirm both users appear on the globe. In one profile, publish a Signal; in the other, open its marker and send a Wave.
3. Accept the Wave in the first profile and exchange messages through the existing chat. Then initiate and accept a video call; grant camera and microphone permission in both profiles.
4. Remove the Signal, close a profile, refresh one profile, and confirm the map updates as expected.

WebRTC uses STUN without TURN. Some corporate or restrictive networks may not establish media connections even when discovery and chat work; test from ordinary networks and browsers with camera/microphone permissions enabled.

## Troubleshooting

- **Build fails during Prisma generation or config loading:** Ensure `DATABASE_URL` is set in Vercel before the build. `prisma.config.ts` reads its datasource URL when Prisma commands load the config. Use Node.js 24.x, then redeploy.
- **`P2022` / a database column or table is missing:** Apply the committed migrations to the same Neon database referenced by `DATABASE_URL`; verify with `npx prisma migrate status`. Do not use `--force-reset` on production.
- **Migration lock, session, or prepared-statement errors:** Confirm the migration command is using `DATABASE_URL_UNPOOLED`, not the `-pooler` URL.
- **“Too many connections” or intermittent database timeouts:** Verify `DATABASE_URL` uses Neon’s pooled endpoint. The app reuses Prisma Client and configures a small per-process `pg` pool; inspect Vercel function concurrency and Neon connection usage before raising pool limits.
- **Map does not render:** Confirm `NEXT_PUBLIC_MAPBOX_TOKEN` is a valid `pk` token, has the public map-rendering scopes, and allows the current deployment hostname. Redeploy after changing it. The placeholder fallback is not a production token.
- **Users cannot discover each other:** Confirm both browser profiles use the same deployed origin, the correct Preview/Production database is selected, location access is allowed, and API function logs show successful `/api/join` and `/api/poll` requests.
- **Chat works but video does not:** Check camera/microphone permissions and test another network. STUN-only connectivity cannot traverse every firewall; TURN is a possible future improvement but is not configured here.
- **Polling or database load grows with traffic:** Each active client polls about every 1.5 seconds, and poll requests perform database work. Monitor Vercel function invocations and Neon load; this design is suitable for request-based serverless hosting but will need measured query/traffic optimization at larger scale.
