# Delivery 7 — lot "auth" notes: Microsoft Entra ID sign-in (R-038) and real users (R-039)

Scope: `docs/DELIVERY-7-PLAN.md` §1 (defaults for R-038 demo mode and R-040 role source) and §2 lot "auth".
Owner decisions applied: I-2a (Entra ID for every EPC2i application), I-2b (no client access at launch: IT opens no
client account; nothing in the code blocks it later), P-10a (a client sees only its organisation's projects), P-13
(the author of an action is the signed-in user), D-7a (IT configures outside the app: no user-administration screen).

## 1. What changed

### R-038 — Microsoft Entra ID sign-in

| Piece | Where | What |
|---|---|---|
| Mode | `src/server/auth/config.ts` | `KEYSTONE_AUTH=demo` (default; also forced to demo in `vitest.config.ts`) keeps the "View as" cookie exactly as before. `KEYSTONE_AUTH=entra` requires a session. Any other value is a configuration error (the proxy answers 500 rather than run unauthenticated). |
| OIDC client | `src/server/auth/oidc.ts`, `crypto.ts` | Authorization code + PKCE (S256), `state` and `nonce`, written on `fetch` + WebCrypto — **no new dependency**. Discovery (the document's `issuer` must equal the configured one), token request (confidential client, `client_secret_post` + `code_verifier`), ID token checks of OIDC Core §3.1.3.7: RS256 signature against the tenant JWKS (`none`, HMAC and other algorithms refused, `crit` refused), `iss`, `aud`/`azp`, `exp`/`nbf`/`iat` with 5 min skew, `nonce`, `tid`. Metadata and keys cached 1 h; an unknown `kid` refreshes the keys once (signing-key rollover). |
| Cookies | `src/server/auth/session-cookie.ts` | Sealed with AES-256-GCM (key derived by HKDF-SHA-256 from `KEYSTONE_SESSION_SECRET`, one key per purpose), HTTP-only, SameSite=Lax, Path=/, Secure and `__Host-` prefixed over https (`__Host-ks-session`, `__Host-ks-signin`; `ks-session`/`ks-signin` on http://localhost only). The session holds the user id, the Entra object id, the active role, issue and expiry times (absolute lifetime, `KEYSTONE_SESSION_HOURS`, default 12). The sign-in cookie (10 min) holds state, nonce, PKCE verifier and return path. |
| Routes | `src/app/api/auth/{sign-in,callback,sign-out}/route.ts` → `src/server/auth/routes.ts` | `GET /api/auth/sign-in?returnTo=` starts the flow; `GET /api/auth/callback` (the redirect URI to register) completes it; `POST /api/auth/sign-out` (POST only; cross-site / foreign-origin requests get 403) clears the session, audits, then redirects (303) to the Entra end-session endpoint, back to `/sign-in?signedOut=1`. All three answer 404 in demo mode. Every redirect uses the public origin of `ENTRA_REDIRECT_URI`; return paths are same-origin paths only (`safeReturnTo`). Refusals land on `/sign-in?error=<code>`, never back on the sign-in route, so a refused account cannot loop through Microsoft. |
| Sign-in page | `src/app/sign-in/page.tsx`, `src/features/auth/sign-in.module.css` | Public page outside the shell (Nocturne card): the refusal / sign-out / misconfiguration message and the "Sign in with Microsoft" button (a plain link to the sign-in route). Demo mode → Home; already signed in without a message → Home. Unknown `error` codes show the generic message, never the raw parameter. |
| Proxy | `src/proxy.ts` | Demo: does nothing. Entra: every request needs a valid session cookie except `/sign-in`, `/api/auth/*`, `/api/health*`, `/_next/*` and the static files of `public/`. A page load without one → 307 to `/api/auth/sign-in?returnTo=<path>`; API calls, Server Function POSTs and script requests (`Sec-Fetch-Dest: empty`: client-side navigations and prefetches — Next hides their RSC headers from the proxy) → 401, so the router reloads the page (which then redirects) and a prefetch never replaces the sign-in cookie of a sign-in in progress. Optimistic check only (cookie, no database). |
| Server-side check | `src/server/session.ts` `getViewer()`, `src/server/auth/viewer.ts` | Entra mode: unseals the session, re-reads the user from the database on every request (memoised per request): unknown user, deactivated user (`users.active`), other Microsoft account (`entra_object_id` changed) or no role left → `redirect('/sign-in?error=session')`. The active role must still be held, else the highest role held is used. Every page, Route Handler and Server Function goes through it, so the proxy is not the only gate. The `ks-role` cookie is ignored. |
| "View as" | `src/server/actions/preferences.ts`, sidebar | Entra mode: the switcher is not rendered (no persona list is sent to the browser) and `setViewAs` refuses ("View as is only available in demo mode") without setting the cookie. |
| Account menu | `src/components/app/shell/account-menu.tsx`, `src/app/(app)/layout.tsx` | Entra mode, in place of "View as" (same trigger and menu): the user's name, the active role (title when one role), "Active role" choice when several roles, "Sign out" (form POST). |
| Active role | `src/server/actions/auth.ts` `setActiveRole` | Entra mode only (demo: refused, "View as" does it). Validates the role against the user's roles from the database, re-seals the session with the same issue time (switching never extends a session), audits, revalidates, lands on Home like "View as". |

### R-039 — real users

| Piece | Where | What |
|---|---|---|
| Users table | `src/server/db/schema/organisation.ts`, migration `drizzle/0007_wet_lester.sql` | One row per person (`person_id` unique): `roles text[]` (every role held), `entra_object_id` (unique — the stable link to the Microsoft account), `email`, `department_id`, `client_id` (organisation), `last_sign_in_at`, `active`, `title`. The former `role` column (unique per persona) keeps its database name but is now nullable and is the TS property `personaRole`: the demo persona a seeded user stands for, null for real users. |
| Identity → person | `src/domain/auth.ts` `decideSignIn`, `src/server/dal/users.ts` `signInUser` | The user already linked to the token `oid` keeps it (even if the e-mail changes). Otherwise the token e-mail (`email`, else `preferred_username`, else `upn`; an `email` marked `xms_edov: false` is ignored) is matched case-insensitively to `persons.email`. Refusals: no e-mail, unknown e-mail, e-mail shared by several persons, person already linked to another Microsoft account, deactivated user, no Keystone role, client role without organisation. A refusal is audited (actor = the token e-mail) and leaves nothing linked. Success creates or refreshes the user in one transaction (roles from the token, department and organisation from the person, title, last sign-in) and audits it; a racing duplicate first sign-in retries once on the unique-constraint violation. |
| Roles | `src/domain/auth.ts` `rolesFromClaims` | Entra app roles in the `roles` claim — values `director`, `pm`, `depthead`, `member`, `englead`, `quality`, `procurement`, `client`, optionally prefixed `Keystone.` (case ignored) — plus groups mapped by `ENTRA_GROUP_ROLES` (`{"<group object id>": "pm" \| ["pm","englead"]}`; a malformed map is a configuration error). `RoleKey` and `ROLE_SCREENS` are unchanged; rights follow the **active** role only. |
| Viewer | `src/config/personas.ts` | `Viewer = Persona` keeps `role, name, title, initials, short` and adds `roles`, `email`, `organisation`, `department`, `personId`, `userId`. The demo personas carry them too (ids null), so every test that mocks `@/server/session` with `PERSONA_BY_ROLE[role]` keeps working unchanged. |
| Client organisation | `project-context.ts`, `dal/portfolio.ts`, export providers `admin.ts`, `aftersales.ts` | The `CLIENT_ORG` constant is removed; client scoping uses `viewer.organisation` (null → no project). Its value stays the demo client persona's organisation (`DEMO_CLIENT_ORG = 'Port authority'`). |
| Ownership | `project-context.ts` `isMineProject`, `dal/projects.ts` | `ProjectRow.pmPersonId` added; a signed-in user owns a project when they are its PM person; the demo personas still match by short name (unique per person). |
| Per-user records | `dal/users.ts` `userIdOf`, `dal/notifications.ts`, `dal/prioritisation.ts`, `dal/pfinance.ts`, `components/app/shell/actions.ts`, `admin/integrations` page | Notification list / unread count / mark read and prioritisation weights are keyed by the user (`viewer.userId`, or the persona user of a demo role). The functions accept a viewer or, as before, a role string (tests, demo). |
| Notification audiences | `dal/notifications.ts`, `dal/requests-screens.ts` | A role audience reaches every active user holding one of the roles. A personal notice (`toPersonIds`) reaches its person only: resource-request and stage-decision notices now go to the recipient person's account, never to the actor (person comparison instead of role comparison). |
| Shell | `dal/shell.ts`, `page-header.tsx`, `(app)/layout.tsx` | Sidebar badges, My tasks, Resource requests and Approvals crumbs, My projects title and notifications are computed for the viewer, not for "the persona of the role" (`PERSONA_BY_ROLE[role]`), so a real PM sees their own tasks and requests. |
| Approver identity | `dal/myapprovals-identity.ts`, `dal/changes.ts`, `db/helpers.ts` | A signed-in user is found by person id; the change-request director step takes the first active user holding the director role; `actorOf` returns every role of the person's active account. |
| Seed and backfill | `db/seed/organisation.ts`, `db/seed/users.ts`, `db/seed/index.ts` | The 8 personas are seeded as users with `roles = [role]`, their e-mail and their person's department; the persona persons get their e-mail. A database seeded before migration 0007 is backfilled once (persona users without roles). |

### Translations

`src/i18n/extra/d7-auth.json` (registered last in `src/i18n/extra/index.ts`; no existing key is overridden): sign-in page,
refusal messages, account menu ("Active role", "Sign out", "Head of department" → "Chef de service"), refusals of the
Server Functions, audit texts ("Sign-in" → "Connexion", "Signed in · Portfolio director / Project manager", "Sign-in
refused · Unknown e-mail", "Active role · … → …" are built from translatable segments).

## 2. Rules and defaults chosen

- **Role priority** (default active role = the first held): director, pm, depthead, englead, quality, procurement,
  member, client (broadest workspace first; `ROLE_PRIORITY`).
- **Session**: stateless sealed cookie, absolute lifetime 12 h (`KEYSTONE_SESSION_HOURS`, 1–168), no sliding renewal.
  Roles are refreshed from the token at each sign-in; deactivating a user (`users.active = false`) or unlinking the
  account ends the session at the next request.
- **Audit, not activity**: sign-in, refused sign-in, sign-out and role switch are written to the audit trail (area
  "Sign-in"); they are not business events, so they do not go to the activity feed (`ActivityKind` has no such kind).
- **Fail closed**: unknown `KEYSTONE_AUTH`, a short secret, a non-GUID tenant, http outside localhost or a malformed
  group map are configuration errors; the proxy and the routes then send pages to `/sign-in?error=config` and API calls
  get 401 / 500.
- **No dependency**: `openid-client`/`jose` were not needed (the flow is small and fully tested with a real RSA key and
  an in-process provider). `dependencies_needed` is empty.

Configuration for IT (to merge into `.env.example`, lot platform-data R-007):

```
KEYSTONE_AUTH=entra
KEYSTONE_SESSION_SECRET=<≥ 32 random characters>
KEYSTONE_SESSION_HOURS=12
ENTRA_TENANT_ID=<directory (tenant) id, GUID>          # or ENTRA_ISSUER for another authority
ENTRA_CLIENT_ID=<application (client) id>
ENTRA_CLIENT_SECRET=<client secret>
ENTRA_REDIRECT_URI=https://<host>/api/auth/callback   # Web redirect URI of the app registration
ENTRA_POST_LOGOUT_REDIRECT_URI=https://<host>/sign-in?signedOut=1   # optional (this is the default)
ENTRA_GROUP_ROLES={"<group object id>":"pm"}          # optional; app roles are preferred
```

App registration: Web platform, the redirect URI above, ID tokens via the authorization code flow, optional claim
`email`, app roles with the values listed in §1 (assigned to users or groups on the enterprise application). With
`ENTRA_GROUP_ROLES`, emit group ids in the ID token (“groups assigned to the application” avoids the 200-group overage,
which Keystone does not resolve through Microsoft Graph).

## 3. Old → new displayed values

None on the seed in demo mode: the personas, their notifications, badges, crumbs, My projects, exports and approvals are
unchanged (the existing golden and DAL tests pass untouched; `src/domain/portfolio.test.ts` only switched from the removed
`CLIENT_ORG` to `DEMO_CLIENT_ORG`, same value). New in Entra mode: the `/sign-in` page and the account menu.

## 4. Migration

`drizzle/0007_wet_lester.sql` (+ `drizzle/meta/0007_snapshot.json`, `_journal.json`): `users.role` nullable; new columns
`roles text[] default '{}' not null`, `entra_object_id`, `email`, `department_id` (FK departments), `last_sign_in_at`;
unique constraints `users_person_id_unique`, `users_entra_object_id_unique`. Data backfill is done by the seed backfill
(`backfillDemoUsers`), not in SQL, so the integrator can regenerate one combined migration.

## 5. Tests

- `src/domain/auth.test.ts` — roles, app-role values, group map, e-mail claims (incl. unverified e-mail), sign-in
  decision (every refusal), titles, safe return paths, public paths.
- `src/server/auth/config.test.ts`, `crypto.test.ts` (PKCE RFC 7636 vector, sealed cookies tampering/purpose/expiry,
  RS256 forged / tampered / `none` / HS256 / unknown key), `oidc.test.ts` (discovery, PKCE exchange, every claim check,
  key rollover, unreachable provider).
- `src/server/auth/entra-flow.test.ts` — end to end against `src/test/mock-entra.ts` (in-process provider through a stubbed
  `fetch`, no network) and an in-memory database: demo mode unchanged (routes 404, "View as" works), callback creates the
  session and links the account, new directory person with mapped groups, client organisation, unknown e-mail refused
  and audited, no role / no organisation, other Microsoft account, deactivated user and roles removed end the session,
  state / expiry / provider error / forged token, configuration error, "View as" refused, role switch (held only, same
  expiry, audited), sign-out (cookie cleared, audit, Microsoft end-session, cross-site 403).
- `src/proxy.test.ts` — demo pass-through, redirect with return path, 401 for API / POST / fetch requests, public paths,
  forged / expired / "View as" cookies, misconfiguration.
- `src/server/dal/users.test.ts` — persona users seeded as in `personas.ts`, backfill, `userIdOf`, role audiences reach
  every holder with per-user read state, personal notices, request notices never to the actor, weights per user,
  ownership by person and organisation, unique-violation detection for the racing first sign-in.
- `src/features/auth/sign-in.test.ts` — sign-in page (FR message, safe return path, no raw parameter, demo / signed-in
  redirects) and the account menu.
- Also run: `src/server/dal`, `src/server/db`, `src/server/export`, `src/server/auth`, `src/server/interchange`,
  `src/server/approvals`, `src/components`, `src/domain`, `src/features/{requests,myapprovals,pfinance,projects,auth}`,
  plan scheduling actions and meeting transcript files — all green.
- Manual check with `next dev --webpack -p 3315` and a local OpenID provider: demo Home unchanged; Entra mode redirects
  pages to the sign-in route and answers 401 to API and fetch requests; the full sign-in ends on Home as Romain Aubert
  (director active, "Directrice de portefeuille"); sign-out redirects to the provider's end-session endpoint; the sign-in
  page shows the French refusal. (In an agent worktree Turbopack refuses the symlinked `node_modules`; `--webpack` works.)

## 6. For the integrator

- `users.role` is now `users.personaRole` in TypeScript (same database column): any new code of another lot that used
  `users.role` must use `users.roles` (roles held) or `userIdOf(q, viewer)` (the viewer's user).
- `CLIENT_ORG` no longer exists: use `viewer.organisation` (or `DEMO_CLIENT_ORG` in seeds and tests).
- `getShellNav`, `crumbExtraOf`, `defaultTitleOf`, `notificationsFor`, `listNotifications`, `countUnreadNotifications`,
  `markNotificationRead`, `markAllNotificationsRead`, `getScoreWeights`, `setScoreWeight`, `resetScoreWeights`,
  `getPrioritisation`, `getPrioritisationScreen` take the viewer (a role string still works for tests and demo);
  `notifyRequestEvent` takes the acting viewer instead of its role; `createNotification` accepts `toPersonIds`.
- The health probe is assumed at `/api/health` (`HEALTH_PATHS` in `src/domain/auth.ts`); adjust if lot platform-data
  chose another path.
- `CLAUDE.md` ("Personas: the View as cookie stands in for authentication") should mention `KEYSTONE_AUTH`.
- Lot "rights" builds on `viewer.personId` / `viewer.userId` / `viewer.organisation` / `viewer.department`. Pre-existing
  rule to revisit there (R-041/R-042), now reachable with real users: `getProjectScope` only makes projects read-only
  when the viewer owns some but not all of them, so a real PM who manages no project, or a client whose organisation has
  no project, is not read-only anywhere.

## 7. Open questions for the owner

1. **Who can sign in in production.** A user signs in only if their e-mail is on a person in Keystone. With the
   production seed (R-011, reference data only) nobody can sign in until the staff directory is loaded (R-027, Cursus
   import) or a first list of people with their e-mails is provided. Which comes first?
2. **E-mail domain of the demo personas.** Assumed `prenom.nom@epc2i.fr` (the client persona keeps the prototype's
   `n.bensaid@port-exemple.fr`). Only the demo data set uses it.
3. **Role order.** The default active role of a multi-role user is the highest in the order director, pm, depthead,
   englead, quality, procurement, member, client. Confirm, and confirm that rights follow the active role only.
4. **Session length and revocation.** 12 h absolute by default; removing a role in Entra takes effect at the next
   sign-in; there is no "sign out everywhere" (it would need a server-side session table). Acceptable?
5. **Client accounts (R-179, I-2b).** Clients are not opened at launch. When they are, Entra B2B guests' tokens may not
   carry their real e-mail; the matching rule for guests (and the `client` app role assignment) must be decided then.
6. **Remaining persona-coupled spots** (for lots rights / debt-ux): the re-baseline approver names
   (`features/schedule/rebaseline.ts`), the forced stage-change dialog's director (`features/projects/force-dialog.tsx`)
   and the contingency draw-down approvers (`dal/risks-screen.ts`) still name the demo personas; DAL writers still
   resolve the actor by name (`findPerson`), which is ambiguous only if two people share a full name (R-041).
