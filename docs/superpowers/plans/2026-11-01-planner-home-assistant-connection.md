# Planner → Home Assistant Connection Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Maxsen staff connect a planner project to a customer's Home Assistant with a pairing code (or a downloaded file), so HA can download that project's floor plan drawings and devices, and nothing else.

**Architecture:** A pure function in `packages/domain` turns a team-saved project into a **home package** (the contract with Plan 2). The server gets a small connection store (single-use pairing codes, hashed long-lived tokens, revocation) and routes: staff routes behind the normal sign-in, and two public routes HA calls (pair, fetch). The web app gets a "Home Assistant" dialog in the project top bar.

**Tech Stack:** pnpm monorepo, TypeScript, Hono (server), React 19 (web), zod, node:test (domain tests), vitest (server/web tests).

**Repo:** `hexxcheang/maxsen-planner` (checked out at `/home/user/maxsen-planner`). **Work on a branch, never push to `main`** (merging deploys to the live app). Open a PR at the end.

**Spec:** `hexxcheang/homeassistantintegration` → `docs/superpowers/specs/2026-11-01-maxsen-floorplan-dashboard-design.md`

## Global Constraints

- Follow the planner's `AGENTS.md`: own branch from latest `main`, small focused commits, Prettier only on changed files, no secrets committed, don't touch `apps/server/src/jiaxin/`.
- Before the PR: `pnpm check`, `pnpm build`, `pnpm e2e` all pass.
- The package and every public route carry **no prices, invoices, billing, customer name, customer contact or property address**, and no leads, inbox or Jiaxin data.
- Text notes are excluded unless "Include notes" is ticked (default off).
- The drawing follows the project's customer floor-plan export settings (`project.exportSettings.floorPlan`): `levels[levelId].smartHome/lighting`, `hiddenCategories`, `showLabels`, `showLedLengths`, `showTrackLabels`, `showLegend` not needed.
- Pairing code: single use, expires **24 hours** after creation if unused.
- A token can read **only its own project's** package. Revoked tokens stop working immediately.
- The package is built from the **team-saved** project (`shared.get(id)`) and the team workspace's `settings` (`shared.getWorkspace()`), never from browser-only data.
- Summary messages to the owner end with http://localhost:5173 (planner `CLAUDE.md`).

## The home package (contract with Plan 2)

Defined in `packages/domain/src/home-package/types.ts`. **Package format note:** the spec said a `.zip`. This plan uses **one JSON document with images embedded as base64**. It has the same content, needs no zip library on either side, and the spec left the format to Claude. Plan 2 consumes exactly this.

```ts
export const HOME_PACKAGE_FORMAT = 'maxsen-home';
export const HOME_PACKAGE_SCHEMA = 1;

export interface HomePackage {
  format: 'maxsen-home';
  schemaVersion: 1;
  project: { id: string; title: string };
  exportedAt: string;            // ISO timestamp
  savedVersion: number;          // SharedMeta.version of the team save used
  levels: HomeLevel[];           // ascending sortOrder; levels with no exported plan are left out
  images: Record<string, HomeImage>; // keyed by planner fileId; each background once
}
export interface HomeImage { mediaType: string; data: string /* base64, no data: prefix */ }
export interface HomeLevel { id: string; name: string; sortOrder: number; plans: HomePlan[] }
export interface HomePlan {
  id: string;
  type: 'smart-home' | 'lighting';
  revision: number;
  width: number;                 // plan units, always 1000
  height: number;                // 1000 * background.height / background.width
  background: { imageId: string; key: string }; // key = `${sourcePageId}|${rotation}|${crop.x},${crop.y},${crop.w},${crop.h}`; equal keys = identical backgrounds
  scene: Scene;                  // buildScene output (render/scene.ts)
  elements: HomeElement[];       // every non-note element of the plan, drawn or not
}
export interface HomeElement {
  id: string;                    // planner element id, stable across saves
  categoryId: CategoryId;
  kind: 'point' | 'led-strip' | 'track' | 'curtain';
  productName: string;
  variantName: string;
  label: string;                 // '' when none or when showLabels is off
  drawn: boolean;                // false when its category is hidden in the export settings
}
```

## Review Focus

1. **Project never team-saved, or saved long ago.** Staff expect to be told: the dialog shows "Uses the team save from <savedAt>", and creating a code for an unsaved project returns 409 `not-saved` with a clear message. *(Task 3 test, Task 4 test)*
2. **A background image file missing on the server.** Staff expect a clear failure, not a package with holes: building returns 409 `missing-drawing` naming the level. *(Task 3 test)*
3. **Someone guessing pairing codes.** After 10 wrong codes from one address in 15 minutes, `pair` returns 429 even for a correct code. *(Task 3 test)*
4. **Token used after revoke, or for another project.** It returns 401 `revoked`/`unknown`, and nothing leaks. *(Task 2 and Task 3 tests)*
5. **Private data leaking through free text.** A project with prices, customer name/address and a note containing "$1,200" produces a package where none of those strings appear (with Include notes off). *(Task 1 test)*

---

### Task 1: Domain: catalogue resolver and home package builder

**Files:**
- Create: `packages/domain/src/home-package/types.ts` (the contract above)
- Create: `packages/domain/src/home-package/build.ts`
- Create: `packages/domain/src/catalogue-resolver.ts`
- Modify: `packages/domain/src/index.ts` (export the three modules)
- Modify: `apps/web/src/lib/data/sample-store.ts:408-431` (`resolverFor` delegates to `catalogueResolver`, behaviour unchanged)
- Test: `packages/domain/test/home-package.test.ts`, `packages/domain/test/catalogue-resolver.test.ts`

**Interfaces:**
- Produces:
  - `catalogueResolver(project: Pick<Project,'catalogueSnapshot'> | undefined, catalogue: { products: Product[]; variants: Variant[] }): VariantResolver` (the same logic as today's web `resolverFor`)
  - `interface HomeSource { project: Project; levels: Level[]; plans: Plan[]; products: Product[]; variants: Variant[] }` (the shape of a team-saved bundle)
  - `buildHomePackage(source: HomeSource, settings: Settings, opts: { includeNotes: boolean; exportedAt: string; savedVersion: number }): { pkg: Omit<HomePackage,'images'>; imageIds: string[] }`. The server attaches `images`.

- [ ] **Step 1: Write failing tests** in `catalogue-resolver.test.ts`: snapshot entry wins over the live catalogue; falls back to variant+product; unknown id → `undefined`.
- [ ] **Step 2: Write failing tests** in `home-package.test.ts`, using `createEmptyPlanDocument` and a minimal two-level fixture built in the test:
  - `levels` sorted by `sortOrder`; a level whose plans are both switched off in `exportSettings.floorPlan.levels` is absent.
  - `width === 1000`, `height === 1000 * bg.height / bg.width`.
  - Two plans with the same sourcePage/rotation/crop share `background.key`. `imageIds` lists each fileId once.
  - An element in a `hiddenCategories` category is in `elements` with `drawn: false` and has no item in `scene.items`.
  - `includeNotes: false` → no `type: 'note'` items and no notes in `elements`; `includeNotes: true` → notes drawn.
  - `showLabels: false` → every `label === ''`.
  - **Privacy (Review Focus 5):** the fixture has `customerName: 'Tan Ah Kow'`, `customerContact: '+65 9123 4567'`, `propertyAddress: '12 Jalan Leak'`, an invoice `priceEdits` entry and a note `'$1,200 extra wiring'`. `JSON.stringify(pkg)` contains none of `Tan Ah Kow`, `9123`, `Jalan Leak`, `$1,200`, `priceEdits`, `billing`.
- [ ] **Step 3: Run** `pnpm --filter @maxsen/domain test`. Expected: the new tests FAIL (modules missing).
- [ ] **Step 4: Implement** `catalogueResolver`, `buildHomePackage` and the types. `buildScene` options come from `exportSettings.floorPlan`, with `showNotes: opts.includeNotes`. Repoint web `resolverFor` to `catalogueResolver`.
- [ ] **Step 5: Run** `pnpm --filter @maxsen/domain test && pnpm --filter @maxsen/web test`. Expected: all PASS.
- [ ] **Step 6: Commit** `feat(domain): build home package for Home Assistant`

### Task 2: Server: Home Assistant connection store

**Files:**
- Create: `apps/server/src/home-assistant/store.ts`
- Test: `apps/server/src/home-assistant/store.test.ts`

**Interfaces:**
- Produces `createHaConnectionStore(dir: string, now?: () => Date)` returning:
  - `createCode(projectId: string, createdBy: string): Promise<{ code: string; expiresAt: string }>`: code is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX`. Matching ignores case and the dash.
  - `redeem(code: string, deviceName: string): Promise<{ token: string; connection: HaConnection } | null>`: null when the code is unknown, used or expired. Token is 32 random bytes, base64url.
  - `verify(token: string): Promise<HaConnection | null>`: null when unknown or revoked. Updates `lastUsedAt`.
  - `list(projectId: string): Promise<HaConnection[]>` (pending codes excluded)
  - `revoke(connectionId: string): Promise<boolean>`
  - `interface HaConnection { id: string; projectId: string; deviceName: string; createdBy: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }`
- Storage: `${dir}/home-assistant.json`, atomic write (same tmp+rename pattern as `shared/store.ts`), serialised writes. Codes and tokens are stored **only as SHA-256 hashes**.

- [ ] **Step 1: Write failing tests:** a code redeems once, then returns null the second time; a code redeems at 23h59m but not at 24h01m (inject `now`); `verify(token)` returns the connection, and returns null after `revoke`; the file contains neither the plain code nor the token; `redeem('abcd2345')` matches code `ABCD-2345`.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/server test -- home-assistant/store`. Expected: FAIL.
- [ ] **Step 3: Implement the store** with `node:crypto` (`randomBytes`, `createHash`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): store Home Assistant pairing codes and tokens`

### Task 3: Server: routes

**Files:**
- Create: `apps/server/src/home-assistant/routes.ts`: `mountHomeAssistant(app, deps)`
- Create: `apps/server/src/home-assistant/package.ts`: `homePackageFor(shared, projectId, opts)`
- Modify: `apps/server/src/app.ts` (new optional `haConnections` dep; call `mountHomeAssistant`)
- Modify: `apps/server/src/index.ts` (create the store with `dataDir`)
- Test: `apps/server/src/home-assistant/routes.test.ts` (same `buildApp` + `call` helper style as `proposals.test.ts`)

**Interfaces:**
- Consumes: Task 1 `buildHomePackage`, `catalogueResolver`; Task 2 store; `shared.get`, `shared.getWorkspace`, `shared.getFile`; `createAttemptLimit` from `security.ts`.
- `homePackageFor(shared, projectId: string, opts: { includeNotes: boolean }): Promise<{ ok: true; pkg: HomePackage } | { ok: false; error: 'not-saved' | 'missing-drawing'; message: string }>`
- Routes (staff routes need sign-in and right `projects`; public routes sit under `/api/public/`, which `auth.guard()` already lets through):

| Method & path | Body / auth | Success | Errors |
|---|---|---|---|
| `POST /api/home-assistant/projects/:id/codes` | `{ includeNotes?: boolean }` (stored with the connection) | `{ code, expiresAt, savedAt }` | 409 `not-saved` |
| `GET /api/home-assistant/projects/:id/connections` | | `{ connections: HaConnection[] }` | |
| `DELETE /api/home-assistant/connections/:cid` | | `{ ok: true }` | 404 |
| `GET /api/home-assistant/projects/:id/package?notes=0\|1` | | HomePackage as attachment `<title> home.json` (`exportFilename` style) | 409 `not-saved` / `missing-drawing` |
| `POST /api/public/home-assistant/pair` | `{ code: string, deviceName: string (1–80) }` | `{ token, projectId, title }` | 400, 401 `bad-code`, 429 `too-many` |
| `GET /api/public/home-assistant/home` | `Authorization: Bearer <token>` | HomePackage JSON, `cache-control: no-store` | 401 `revoked`/`unknown`, 409 as above |

- The store keeps `includeNotes` on the connection (add `includeNotes: boolean` to `HaConnection` and `createCode`'s args; update the Task 2 tests).
- Pairing attempts use `createAttemptLimit({ max: 10, windowMs: 15 * 60_000 })`.

- [ ] **Step 1: Write failing tests:**
  - Full flow: staff create a code → public pair → public home returns a package whose `project.id` matches.
  - Signed-out staff route → 401. A signed-in account without `projects` → 403.
  - **Review Focus 1:** a code for an unsaved project → 409 `not-saved`.
  - **Review Focus 2:** a saved project whose background file is absent → 409 `missing-drawing`, with the level name in `message`.
  - **Review Focus 3:** 10 bad codes, then a good code → 429.
  - **Review Focus 4:** a token after `DELETE` → 401 `revoked`; an unknown token → 401 `unknown`; the response body has no project data.
  - Public responses never include `customerName` (assert on the body string).
- [ ] **Step 2: Run** `pnpm --filter @maxsen/server test -- home-assistant`. Expected: FAIL.
- [ ] **Step 3: Implement** `homePackageFor` (attach `images` by reading each `imageId` with `shared.getFile`; media type from the stored file) and the routes.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @maxsen/server test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(server): Home Assistant pairing and home package routes`

### Task 4: Web: "Home Assistant" dialog

**Files:**
- Create: `apps/web/src/features/project/HomeAssistantDialog.tsx`
- Create: `apps/web/src/features/project/home-assistant-api.ts`
- Modify: `apps/web/src/features/project/ProjectLayout.tsx` (a "Home Assistant" button in the right top-bar slot beside `TeamSave`; opens the dialog)
- Test: `apps/web/src/features/project/__tests__/HomeAssistantDialog.test.tsx`

**Interfaces:**
- `home-assistant-api.ts`: `createCode(projectId, includeNotes): Promise<{code; expiresAt; savedAt}>`, `listConnections(projectId): Promise<HaConnection[]>`, `revokeConnection(cid): Promise<void>`, `packageUrl(projectId, includeNotes): string`. These use the same fetch/error conventions as `lib/shared/api.ts`.
- Dialog contents (Radix Dialog like `ProjectDetailsDialog`):
  - "Include notes" checkbox, off.
  - **Create pairing code** button → shows the code large, "Expires <time>", and "Uses the team save from <savedAt>". On 409 `not-saved`: "Save this project to the team first."
  - Connections list: device name, connected date, last used, **Disconnect** button (confirm first).
  - "Download home file" link (the file fallback).
  - Hidden for users without the `projects` right, same as other project actions.

- [ ] **Step 1: Write failing tests:** creating a code displays `ABCD-2345` and the save time; a 409 shows "Save this project to the team first."; Disconnect calls `revokeConnection` after confirm and removes the row. Mock the API module.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/web test -- HomeAssistantDialog`. Expected: FAIL.
- [ ] **Step 3: Implement** the dialog and the API module.
- [ ] **Step 4: Run** `pnpm check && pnpm build && pnpm e2e`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(web): connect a project to Home Assistant`, then push the branch and open a PR to `main` describing the new public endpoints and their limits.
