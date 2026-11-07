# Urii MongoDB backend

## Run

Copy `.env.example` to `.env`, set a private MongoDB URI and a random `JWT_SECRET`, then run:

```sh
npm install
npm run dev
```

The API listens on port `3002` by default. Static files in `public/` are served from the site root, so an image at `public/images/avatar_user.jpeg` is available at `/images/avatar_user.jpeg`. `CORS_ORIGINS` is a comma-separated list of allowed browser origins.

For local development only, `NODE_ENV=development` and `ALLOW_PUBLIC_USER_READS=true` allow unauthenticated `GET /api/users` and `GET /api/users/:id` requests from localhost. Password hashes are always excluded. This exposes user profile data from the configured database, so use only with test data; the option is ignored outside development and requests not originating from loopback still require an admin token. Keep `ALLOW_PUBLIC_USER_READS=false` or unset it outside local testing.

Socket.IO runs on the same port under the `/admin` namespace. Connect with a JWT in the Socket.IO `auth.token` field; only admin tokens are accepted. Successful Product, Order, Custom Order, User, Category, Blog, Comment, Gallery, Saved Map, Chat Session, and Chatbot FAQ create, update, and delete operations broadcast `crud:changed` with `{ resource, action, id }`. Socket connections from origins outside `CORS_ORIGINS` are rejected.

## Seed data

`npm run seed` is for development only; it refuses to run when `NODE_ENV=production`. It inserts fixture records that do not already exist and does not delete or overwrite database records. Plain fixture passwords are bcrypt-hashed in MongoDB, pre-hashed passwords are not hashed again, and social-only fixture users have no local password. Users marked `$GENERATE` get independent random passwords; their one-time credentials are stored in the Git-ignored `my-server-mongodb/.seed-user-credentials.json`. Keep that file private and remove it securely when no longer needed. Existing users with matching emails are preserved and their credentials are not changed.

Create an additional administrator by setting `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (at least 12 characters), and optionally `SEED_ADMIN_NAME`, then running:

```sh
npm run seed:admin
```

The admin seed hashes the configured password and only updates an existing account if it already has the admin role. Do not use demo credentials or commit `.env`.

### OAuth sign-in

Google and Facebook OAuth use the authorization-code flow. Register these callback URLs in each provider's developer console (use the same externally reachable HTTPS backend origin in production):

- `GOOGLE_OAUTH_CALLBACK_URL`
- `FACEBOOK_OAUTH_CALLBACK_URL`

Set each provider's client ID, client secret, and callback URL in the backend `.env`. Facebook Graph API defaults to `v26.0`; override `FACEBOOK_GRAPH_VERSION` if your app is configured for another supported version. Never put OAuth client secrets in browser code or commit them. Google sign-in requires a verified email; Facebook must return an email. OAuth state is protected with a short-lived HttpOnly, SameSite=Lax cookie. Users are stored with `authProviders` and provider subject IDs in `oauthAccounts`; OAuth-only users do not have a local password.

Start sign-in by navigating the browser to `GET /api/auth/oauth/google` or `GET /api/auth/oauth/facebook`. The registered callback returns the backend JWT and user profile as JSON. Existing password accounts are not automatically linked to a social identity with the same email; they must use their registered sign-in method.

If an existing database was populated by the old seed script, migrate its plaintext demo passwords before continuing:

```sh
npm run migrate:passwords
```

This command updates only stored passwords that are not already bcrypt hashes; it aborts if a legacy password exceeds bcrypt's 72-byte limit.

## API access

Product, category, blog, comment, gallery, FAQ, product-review reads, active-voucher reads, and custom-order submissions are public. Cart operations and review creation/history require a bearer JWT for the owning customer. Mutations for managed data, private user/order data, saved maps, chat administration, and dashboard endpoints require an admin JWT. Chat clients can create/update their session and send messages through the chat session endpoints. List endpoints accept `page` and `limit` query parameters; the maximum page size is 100.

Admin CRUD endpoints require `Authorization: Bearer <token>` from an admin account:

| Resource | Endpoints |
| --- | --- |
| Products | `GET /api/products`, `GET /api/products/:id`, `POST /api/products`, `PUT/PATCH /api/products/:id`, `DELETE /api/products/:id` |
| Orders | `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `PUT/PATCH /api/orders/:id`, `DELETE /api/orders/:id` |
| Cart (customer JWT) | `GET /api/cart`, `POST /api/cart/items`, `PATCH /api/cart/items/:itemId`, `DELETE /api/cart/items/:itemId`, `DELETE /api/cart` |
| Reviews | `GET /api/reviews/product/:productId` (public); customer JWT: `GET /api/reviews/mine`, `GET /api/reviews/eligible-orders`, `POST /api/reviews` |
| Custom orders | `POST /api/custom-orders` (public); admin: `GET /api/custom-orders`, `GET /api/custom-orders/:id`, `PUT/PATCH /api/custom-orders/:id`, `DELETE /api/custom-orders/:id` |
| Users | `GET /api/users`, `GET /api/users/:id`, `POST /api/users`, `PUT/PATCH /api/users/:id`, `DELETE /api/users/:id` |
| Promotions | `GET /api/vouchers/manage`, `GET /api/vouchers/:id`, `POST /api/vouchers`, `PUT/PATCH /api/vouchers/:id`, `DELETE /api/vouchers/:id` |
| Categories | `GET /api/categories`, `GET /api/categories/:id`, `POST /api/categories`, `PUT/PATCH /api/categories/:id`, `DELETE /api/categories/:id` |
| Blogs | `GET /api/blogs`, `GET /api/blogs/:slug` (public); user/admin JWT: `POST /api/blogs`; admin: `PUT/PATCH /api/blogs/:id`, `DELETE /api/blogs/:id` |
| Comments | `GET /api/comments`, `GET /api/comments/:id` (public); user/admin JWT: `POST /api/comments`; admin: `PUT/PATCH /api/comments/:id`, `DELETE /api/comments/:id` |
| Gallery | `GET /api/gallery`, `GET /api/gallery/:mapId`, `POST /api/gallery`, `PUT/PATCH /api/gallery/:mapId`, `DELETE /api/gallery/:mapId` |
| Saved maps | `GET /api/saved-maps`, `GET /api/saved-maps/:id`, `POST /api/saved-maps`, `PUT/PATCH /api/saved-maps/:id`, `DELETE /api/saved-maps/:id` |
| Chatbot FAQs | `GET /api/chat/faqs`, `GET /api/chat/faqs/:id`, `POST /api/chat/faqs`, `PUT/PATCH /api/chat/faqs/:id`, `DELETE /api/chat/faqs/:id` |
| Chat sessions | `GET /api/chat/sessions`, `GET /api/chat/sessions/:id`, `POST /api/chat/sessions`, `PUT/PATCH /api/chat/sessions/:id`, `DELETE /api/chat/sessions/:id` |
| Dashboard | `GET /api/dashboard` |

`GET /api/vouchers` remains public and only returns active, currently available vouchers. `POST /api/chat/match`, `POST /api/chat/sessions`, and `POST /api/chat/sessions/:id/messages` are public chatbot-client operations. User API responses never include password hashes; passwords submitted to the admin user endpoints are bcrypt-hashed before storage.

Cart prices and stock are read from the product and its selected variant; client-supplied prices are ignored. Reviews can only be created for products in the customer's successfully delivered orders, and each order/product pair can be reviewed once. Every review stores a 1–5 star rating and the purchased product and variant; text and media are optional. `data/review_orders.json` intentionally has 31 star-only reviews, 20 reviews with text only, and 10 with media (7 image and 3 video reviews). Orders contain customer/product/variant IDs and delivery status, while reviews focus on order/product IDs, rating, comment, and optional media. Product and variant labels, customer details, prices, and other data are joined from their existing fixtures. It includes delivered orders that are both reviewed and not yet reviewed, with every product covered by at least one rating. The development seed inserts this data without replacing existing records. Upload it to Atlas with `npm run upload -- carts`, then `npm run upload -- review-orders`, followed by `npm run upload -- reviews`.

Review creation accepts `orderId`, `productId`, `rating` (integer from 1 to 5), optional `content`, and optional `media` entries (`type: "image" | "video"` and a backend `/images/...` path or HTTP(S) URL). A rating by itself is a valid review. The reviewed variant is taken from the purchased order item, not trusted from the request.

`data/orders.json` stores customer, product, voucher, and state references by ID instead of repeating their labels and details. Item `unitPrice`, order `totalAmount`, voucher `discountAmount`, and the shipping address remain snapshots so later catalog or profile changes do not rewrite order history. `data/order_statuses.json` contains the labels and icons for order statuses, plus the labels for payment, order-timeline, and shipping-timeline status IDs. The dedicated `data/review_orders.json` fixture uses the same `statusId` convention.

`data/order_reasons.json` contains the cancellation/return reason catalog. Cancelled and returned records in `data/orders.json` reference catalog entries with `cancellationReasonId` or `returnReasonId`; return evidence is stored in `returnEvidence`. The development seed updates only these reason fields on existing matching orders, preserving their other data.

```json
{
  "orderId": "UR-REVIEW-001",
  "productId": "1075483767",
  "rating": 5,
  "content": "Màu hồng đẹp, dùng tốt như mô tả.",
  "media": [{ "type": "image", "url": "/images/orders/bo-kit.jpeg" }]
}
```

Use the plural resource paths shown in the endpoint table as the canonical API paths. Singular resource paths and gallery aliases `/api/maps` and `/api/map` are also supported for compatibility. The old customer-order and sample-map route aliases are not supported.

Gallery data uses one name across the application: `data/gallery.json`, `models/Gallery.js`, the `/api/gallery` endpoint, and the MongoDB Atlas collection `gallery`. Run `npm run migrate:gallery` once to merge any existing `samplemaps` records into `gallery`, verify them, and remove the old collection. The old sample-map routes are removed; `/api/maps` and `/api/map` remain compatibility aliases for the gallery.

The `data/saved_maps.json` fixture is grouped by customer: each entry has a `userId` and 2–5 `mapIds` from the gallery. Seed/upload resolve map details from the gallery and create records keyed by `(userId, mapId)`. A customer can save a given map once, while different customers can save the same map.

Custom-order submission accepts `fullName`, `phone`, `email`, `requestName`, `size`, `beadType`, `imageUrl`, and optional `description` and `imageNote`. `imageUrl` can be a portable backend path such as `/images/gallery_assets/mau-ca-heo.webp` or an absolute HTTP(S) URL. When using a relative path, the frontend should resolve it against the configured backend base URL (for example, `new URL(imageUrl, API_BASE_URL)`) so the image loads from the backend on any machine. New requests start with status `pending`.

The development seed also inserts records from `data/custom_orders.json` when their `id` is not already in MongoDB. Fixture image paths are relative to the backend and do not hardcode a machine name or address.

Upload only this fixture to Atlas with `npm run upload:custom-orders`. It upserts records by `id` and does not delete other custom orders. The application uses the MongoDB collection `custom_orders` and the API path `/api/custom-orders`. The one-time migration merges records from any old `customerorders` or `customorders` collections into `custom_orders`, verifies them, and removes those old collections.

```sh
curl -X POST http://localhost:3002/api/custom-orders \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Nguyễn An","phone":"0901234567","email":"an@example.com","requestName":"Móc khóa thú cưng","size":"15 x 15","beadType":"Hạt Perler 5mm (Midi Beads)","description":"Màu sắc sáng, lấy phần chân dung","imageNote":"Cắt nền giúp mình","imageUrl":"/images/gallery_assets/mau-ca-heo.webp"}'
```
