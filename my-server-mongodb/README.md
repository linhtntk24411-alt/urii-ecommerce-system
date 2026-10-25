# Urii MongoDB backend

## Run

Copy `.env.example` to `.env`, set a private MongoDB URI and a random `JWT_SECRET`, then run:

```sh
npm install
npm run dev
```

The API listens on port `3002` by default. Static files in `public/` are served from the site root, so an image at `public/images/avatar_user.jpeg` is available at `/images/avatar_user.jpeg`. `CORS_ORIGINS` is a comma-separated list of allowed browser origins.

## Seed data

`npm run seed` is for development only; it refuses to run when `NODE_ENV=production`. It inserts fixture records that do not already exist and does not delete or overwrite database records. New fixture users get independent, randomly generated passwords that are bcrypt-hashed in MongoDB. Their one-time credentials are stored in the Git-ignored `my-server-mongodb/.seed-user-credentials.json`; keep that file private and remove it securely when no longer needed. Existing users with matching emails are preserved and their credentials are not changed.

Create an additional administrator by setting `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (at least 12 characters), and optionally `SEED_ADMIN_NAME`, then running:

```sh
npm run seed:admin
```

The admin seed hashes the configured password and only updates an existing account if it already has the admin role. Do not use demo credentials or commit `.env`.

If an existing database was populated by the old seed script, migrate its plaintext demo passwords before continuing:

```sh
npm run migrate:passwords
```

This command updates only stored passwords that are not already bcrypt hashes; it aborts if a legacy password exceeds bcrypt's 72-byte limit.

## API access

Product, category, blog, comment, map, and active-voucher reads are public. Product creation/deletion and access to users/orders require a bearer JWT for an admin account. List endpoints accept `page` and `limit` query parameters; the maximum page size is 100.
