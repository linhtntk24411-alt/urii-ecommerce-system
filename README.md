# Urii Ecommerce System

Urii is an ecommerce application with separate Angular storefront and admin applications, plus an Express/MongoDB API.

## Project structure

- `projects/my-user/` — customer-facing Angular application.
- `projects/my-admin/` — admin dashboard, promotions, and user management.
- `my-server-mongodb/` — Express API, Mongoose models, seed data, and backend tests.

## Run locally

Install frontend dependencies from the repository root:

```sh
npm install
```

Start the storefront or admin app in its own terminal:

```sh
npm start -- --project my-user
npm start -- --project my-admin
```

The Angular dev-server proxy sends `/api` requests to `http://localhost:3002`. Start the backend separately:

```sh
cd my-server-mongodb
npm install
```

Copy `.env.example` to `.env`, set a private MongoDB URI and a random `JWT_SECRET`, then run:

```sh
npm run dev
```

Create an admin using the backend's `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and optional `SEED_ADMIN_NAME` environment variables, then run `npm run seed:admin`. Do not commit `.env` or use demo credentials. See [the backend README](./my-server-mongodb/README.md) for seed safety and API details.

## Build and tests

```sh
npm run build -- --project my-user
npm run build -- --project my-admin
npm test -- --project my-admin --watch=false
```

Backend tests:

```sh
cd my-server-mongodb
npm test
```
