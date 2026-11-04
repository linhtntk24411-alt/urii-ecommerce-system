# Urii MongoDB backend

## Run

Copy `.env.example` to `.env`, set a private MongoDB URI and a random `JWT_SECRET`, then run:

```sh
npm install
npm run dev
```

The API listens on port `3002` by default. Static files in `public/` are served from the site root, so an image at `public/images/avatar_user.jpeg` is available at `/images/avatar_user.jpeg`. `CORS_ORIGINS` is a comma-separated list of allowed browser origins.

Socket.IO runs on the same port under the `/admin` namespace. Connect with a JWT in the Socket.IO `auth.token` field; only admin tokens are accepted. Successful Product, Order, Custom Order, User, Category, Blog, Comment, Gallery, Saved Map, Chat Session, and Chatbot FAQ create, update, and delete operations broadcast `crud:changed` with `{ resource, action, id }`. Socket connections from origins outside `CORS_ORIGINS` are rejected.

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

Product, category, blog, comment, gallery, FAQ, active-voucher reads, and custom-order submissions are public. Mutations for managed data, private user/order data, saved maps, chat administration, and dashboard endpoints require a bearer JWT for an admin account. Chat clients can create/update their session and send messages through the chat session endpoints. List endpoints accept `page` and `limit` query parameters; the maximum page size is 100.

Admin CRUD endpoints require `Authorization: Bearer <token>` from an admin account:

| Resource | Endpoints |
| --- | --- |
| Products | `GET /api/products`, `GET /api/products/:id`, `POST /api/products`, `PUT/PATCH /api/products/:id`, `DELETE /api/products/:id` |
| Orders | `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `PUT/PATCH /api/orders/:id`, `DELETE /api/orders/:id` |
| Custom orders | `POST /api/custom-orders` (public); admin: `GET /api/custom-orders`, `GET /api/custom-orders/:id`, `PUT/PATCH /api/custom-orders/:id`, `DELETE /api/custom-orders/:id` |
| Users | `GET /api/users`, `GET /api/users/:id`, `POST /api/users`, `PUT/PATCH /api/users/:id`, `DELETE /api/users/:id` |
| Promotions | `GET /api/vouchers/manage`, `GET /api/vouchers/:id`, `POST /api/vouchers`, `PUT/PATCH /api/vouchers/:id`, `DELETE /api/vouchers/:id` |
| Categories | `GET /api/categories`, `GET /api/categories/:id`, `POST /api/categories`, `PUT/PATCH /api/categories/:id`, `DELETE /api/categories/:id` |
| Blogs | `GET /api/blogs`, `GET /api/blogs/:slug`, `POST /api/blogs`, `PUT/PATCH /api/blogs/:id`, `DELETE /api/blogs/:id` |
| Comments | `GET /api/comments`, `GET /api/comments/:id`, `POST /api/comments`, `PUT/PATCH /api/comments/:id`, `DELETE /api/comments/:id` |
| Gallery | `GET /api/gallery`, `GET /api/gallery/:mapId`, `POST /api/gallery`, `PUT/PATCH /api/gallery/:mapId`, `DELETE /api/gallery/:mapId` |
| Saved maps | `GET /api/saved-maps`, `GET /api/saved-maps/:id`, `POST /api/saved-maps`, `PUT/PATCH /api/saved-maps/:id`, `DELETE /api/saved-maps/:id` |
| Chatbot FAQs | `GET /api/chat/faqs`, `GET /api/chat/faqs/:id`, `POST /api/chat/faqs`, `PUT/PATCH /api/chat/faqs/:id`, `DELETE /api/chat/faqs/:id` |
| Chat sessions | `GET /api/chat/sessions`, `GET /api/chat/sessions/:id`, `POST /api/chat/sessions`, `PUT/PATCH /api/chat/sessions/:id`, `DELETE /api/chat/sessions/:id` |
| Dashboard | `GET /api/dashboard` |

`GET /api/vouchers` remains public and only returns active, currently available vouchers. `POST /api/chat/match`, `POST /api/chat/sessions`, and `POST /api/chat/sessions/:id/messages` are public chatbot-client operations. User API responses never include password hashes; passwords submitted to the admin user endpoints are bcrypt-hashed before storage.

Use the plural resource paths shown in the endpoint table as the canonical API paths. Singular resource paths and documented gallery aliases are also supported for compatibility; the old customer-order and sample-map route aliases are not supported.

Gallery data uses one name across the application: `data/gallery.json`, `models/Gallery.js`, the `/api/gallery` endpoint, and the MongoDB Atlas collection `gallery`. Run `npm run migrate:gallery` once to merge any existing `samplemaps` records into `gallery`, verify them, and remove the old collection. The old `/api/maps` and sample-map route aliases have been removed.

Custom-order submission accepts `fullName`, `phone`, `email`, `requestName`, `size`, `beadType`, `imageUrl`, and optional `description` and `imageNote`. `imageUrl` can be a portable backend path such as `/images/gallery_assets/mau-ca-heo.webp` or an absolute HTTP(S) URL. When using a relative path, the frontend should resolve it against the configured backend base URL (for example, `new URL(imageUrl, API_BASE_URL)`) so the image loads from the backend on any machine. New requests start with status `pending`.

The development seed also inserts records from `data/custom_orders.json` when their `id` is not already in MongoDB. Fixture image paths are relative to the backend and do not hardcode a machine name or address.

Upload only this fixture to Atlas with `npm run upload:custom-orders`. It upserts records by `id` and does not delete other custom orders. The application uses the MongoDB collection `custom_orders` and the API path `/api/custom-orders`. The one-time migration merges records from any old `customerorders` or `customorders` collections into `custom_orders`, verifies them, and removes those old collections.

```sh
curl -X POST http://localhost:3002/api/custom-orders \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Nguyễn An","phone":"0901234567","email":"an@example.com","requestName":"Móc khóa thú cưng","size":"15 x 15","beadType":"Hạt Perler 5mm (Midi Beads)","description":"Màu sắc sáng, lấy phần chân dung","imageNote":"Cắt nền giúp mình","imageUrl":"/images/gallery_assets/mau-ca-heo.webp"}'
```
