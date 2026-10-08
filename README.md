# orca

## Setup

Install dependencies:

```bash
bun install
```

Create a `.env` file if you want to override the local defaults.

Run migrations:

```bash
bun run migrate
```

Run the dev server (API + Vite frontend concurrently):

```bash
bun dev
```

## Environment

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite://orca.db` | SQLite database path |
| `JWT_SECRET` | Dev-only fallback | Secret used to sign auth tokens. Set this in production. |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend dev origin |
| `NODE_ENV` | unset | Use `production` when deploying. `bun dev` sets `development`, which enables dev verification. |
| `APP_URL` | `http://localhost:5173` outside production | Public app origin for email verification links. Required in production and must use HTTPS. |
| `POSTMARK_SERVER_TOKEN` | none | Postmark server API token. Keep this in the environment or an ignored `.env` file. |
| `POSTMARK_FROM` | `noreply@01z.io` | Sender address authorized in Postmark. |

Run migrations before starting after an update (`bun run migrate`). Migration 003 adds the single-use email verification tokens table.

## Architecture

- Backend: Hono + SQLite (`bun:sqlite`) + Bun.serve
- Frontend: Svelte SPA built with Vite, served as static files by Hono in production

## Auth

- Users sign up and log in with email, username, and password.
- Passwords are hashed with `Bun.password`.
- The API returns a JWT, and the frontend stores it in `localStorage`.
- Authenticated requests use `Authorization: Bearer <token>`.
- Email verification gates market creation, trading, and comments. Signed-in users can request an email from the verification banner, then open the link and confirm their email address.
- Emails use the [Postmark HTTP API](https://postmarkapp.com/developer/api/email-api) directly, without an SDK. Configure `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM`, and the public `APP_URL`. The sender must be authorized in Postmark.
- Verification links expire after one hour, are single-use, and only their hashes are stored. Resends are limited to one per minute per account and replace the previous link.
- The dev verification endpoint is available only with `NODE_ENV=development`; its button is excluded from production frontend builds.

## Product Surface

- Public users can browse markets, comments, profiles, and leaderboards.
- Verified users can create binary Yes/No markets, trade through the LMSR-style AMM, comment, resolve their own closed markets, and reset their play-money balance when they have no open positions.
- Markets expire and refund after 7 unresolved days past close when public market endpoints, resolution, or account reset are accessed. Late resolution requests cannot bypass expiry.
- Trading, resolution, refunds, and account resets use synchronous write transactions. Realized sale profit/loss and settlement profit/loss both count toward the profit leaderboard.

## Checks

```bash
bun test
bun run typecheck
bun run build:frontend
```

Tests use an in-memory database and mocked Postmark responses; they do not send email or touch the local app database.

## Brick deployment

Production runs at https://orca.01z.io from `/var/www/orca` as `deploy:www-data`,
with Bun at `/home/deploy/.bun/bin/bun`, systemd, and Caddy. The application binds
to `127.0.0.1:6003`. SQLite persists at `/var/www/orca/orca.db`; the database and
the server-owned `.env` are ignored by Git and preserved across deployments.

For initial provisioning, clone this repository's `main` branch into that path as
`deploy`, and create a mode `0600`, deploy-owned `.env` containing:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=6003
DATABASE_URL=sqlite:///var/www/orca/orca.db
APP_URL=https://orca.01z.io
CORS_ORIGIN=https://orca.01z.io
JWT_SECRET=<generate a strong random production secret>
POSTMARK_SERVER_TOKEN=<configured securely>
POSTMARK_FROM=noreply@01z.io
```

After pushing `main`, deploy from your local checkout:

```bash
bash deploy/deploy.sh
```

The script requires a clean server checkout, fast-forwards to `origin/main`,
installs locked dependencies, runs tests and type checks, builds the frontend,
stops an existing service, makes and integrity-checks a timestamped SQLite backup
under `/var/backups/orca/`, applies migrations, and installs/restarts the systemd
unit. A fresh installation has no existing database to back up. Failures stop
the deployment; a migration failure leaves the service stopped for inspection.

For initial routing, point the `orca.01z.io` A record to Brick, install
`deploy/orca.caddy` at `/etc/caddy/orca.caddy`, and add its import to the main
`Caddyfile.j2` in the sibling Brick repository. Install that rendered configuration,
validate with `caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy.
Routine deployments do not change routing.

Verify the deployed revision, `orca.service`, loopback and public HTTPS responses,
and recent service logs. Record the previous revision before each update. Code
rollback requires checking database compatibility; do not automatically reverse
migrations or restore a database over newer data.
