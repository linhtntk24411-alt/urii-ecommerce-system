# Urii Ecommerce System

This repository is an Angular monorepo with two applications:

- `projects/my-user`: customer-facing storefront.
- `projects/my-admin`: administration application.

Shared Angular CLI, TypeScript, npm dependencies, and development proxy
configuration are maintained at the repository root.

## Prerequisites

- Node.js and npm.
- The backend API listening at `http://localhost:3002`.

Install frontend dependencies from the repository root:

```bash
npm install
```

## Development

Start either application from the repository root:

```bash
npm start
npm run start:admin
```

Both development servers use [proxy.conf.json](./proxy.conf.json), which
forwards `/api` requests to the local backend. The backend remains a separate
project under `my-server-mongodb`.

## Build and test

```bash
npm run build
npm run build:admin
npm test
```

`npm run build` and `npm test` target the customer app by default. The Angular
projects can also be selected directly with `npx ng build my-user`,
`npx ng build my-admin`, or `npx ng test my-user`.

## Customer app core

The customer app keeps domain models in `projects/my-user/src/app/models` and
application-wide services and HTTP interceptors in
`projects/my-user/src/app/core`.

- `UriUser` is the typed user model; `AuthService` expects login and
  registration responses shaped as `{ "token": "...", "user": { "id": "...",
"name": "...", "email": "..." } }`. MongoDB `_id` is also accepted.
- `StorageService` persists the auth token and user in browser local storage
  and does not access browser storage during server rendering.
- The auth interceptor adds a bearer token only to same-origin `/api` requests.
- `NotificationService` exposes notifications as an Angular read-only signal;
  callers can add, dismiss, or clear success, error, warning, and info messages.

The API routes used by `AuthService` are `POST /api/auth/login` and
`POST /api/auth/register`. Update those paths or response model if the backend
uses a different contract. For production deployments, prefer secure,
HttpOnly cookies over long-lived tokens in local storage.
