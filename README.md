# vidya-predictions

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

| Variable | Purpose |
|----------|---------|
| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite://vidya.db` | SQLite database path |
| `JWT_SECRET` | Dev-only fallback | Secret used to sign auth tokens. Set this in production. |
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend dev origin |

## Architecture

- Backend: Hono + SQLite (`bun:sqlite`) + Bun.serve
- Frontend: Svelte SPA built with Vite, served as static files by Hono in production

## Auth

- Users sign up and log in with email and password.
- Passwords are hashed with `Bun.password`.
- The API returns a JWT, and the frontend stores it in `localStorage`.
- Authenticated requests use `Authorization: Bearer <token>`.
