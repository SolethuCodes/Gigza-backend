# Login architecture (backend)

Customers live in `users`. Providers live in `providers`. Email and phone are unique **per table**, so one email may have **one customer and one provider**, never two of the same type. Admin auth is separate (`admins`) and unchanged.

Social login **does not** take a client-chosen role. Identity (email / linked OAuth id) is resolved server-side.

## Account rules

- Register customer: `POST /auth/register` — fails if that email/phone already exists on `users`. A provider with the same email is allowed.
- Register provider: `POST /auth/provider/register` — same, scoped to `providers`.
- Duplicate-type errors tell the client to sign in or create the **other** type.

## Email / password (unchanged endpoints)

| Endpoint | Table |
|---|---|
| `POST /auth/login` | `users` (may return `requiresTwoFactor`) |
| `POST /auth/provider/login` | `providers` |
| `POST /auth/admin/login` | `admins` |

The mobile app calls the first two in parallel and, if both succeed, lets the user pick which session to keep. This service still authenticates one table per request.

## Social login

```
GET  /auth/google            → Google, then callback
GET  /auth/facebook          → Facebook, then callback
POST /auth/oauth/exchange    → one-time code → session or next-step flags
POST /auth/oauth/select-account    { selectionToken, accountType }
POST /auth/oauth/complete-signup   { creationToken, role }
```

`handleOAuthLogin` (no role argument):

1. Look up customer and provider by email **or** linked `oauth_accounts` row.
2. **Only one usable account** → issue tokens for that type (`accountType: user | provider`).
3. **Both usable** → Redis `oauth_selection:{token}` for 5 minutes. Return `requiresAccountSelection` + `availableAccounts`. Tokens are issued only after `select-account`.
4. **None** → Redis `oauth_creation:{token}` (OAuth profile, 5 minutes). Return `requiresAccountCreation`. `complete-signup` creates **one** row of the chosen type and links OAuth.
5. **Suspended and no other usable account** → 401.

`?role=` on the Google/Facebook start URL is ignored. One `oauth_accounts` row (`provider` + `providerAccountId` unique) can point at both a user and a provider (`userId` / `providerId`).

Provider social sessions include `requiresOnboarding` when `kycStatus !== APPROVED`. The mobile app uses this for the post-login KYC invite; KYC itself is completed in-app via Sumsub and finalized by webhook. There is no admin approve/reject step.

### Local callbacks

Google and Facebook will not redirect to a LAN IP. For phone testing against a local API:

1. `ngrok http 4000`
2. Set `GOOGLE_CALLBACK_URL` and `FACEBOOK_CALLBACK_URL` to `https://<ngrok-host>/api/v1/auth/<provider>/callback`
3. Put the same URLs in the Google / Facebook app consoles
4. Restart the API and keep ngrok running

`MOBILE_APP_SCHEME` must stay `errands` so the callback can return `errands://auth/callback?code=...`.

## Implementation

- `src/modules/auth/auth.service.ts` — register uniqueness, OAuth resolve / select / complete-signup
- `src/modules/auth/auth.controller.ts` — routes above
- Guards (`google-auth.guard.ts`, `facebook-auth.guard.ts`) — pass `clientState` only; they do not encode a role
