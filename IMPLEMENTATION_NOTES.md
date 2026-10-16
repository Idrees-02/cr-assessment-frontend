# Implementation Notes

## 0. Orientation

The app has two screens. The **list** loads the caller's org-scoped CRs into a single `ViewState`
(loading / loaded / empty / error) and narrows what it renders with a status filter. The **detail**
pane loads one CR into its own `ViewState`, then derives everything else from it: the line-item diff,
the chronological timeline, and whether Approve/Reject are available to the current user (CR status
plus the user's policies from `SessionService`). Approve/Reject go through `CrApiService`. While an
action is in flight the controls lock. On success the server's CR replaces the loaded one. On failure
the CR stays on screen with an inline error.

## 1. What I changed

**Task 1: root-cause fixes**
- `diff.util.ts`: a line was only `changed` if its **unit price** differed, so a quantity-only change
  showed as `unchanged`. `isLineChanged` now compares quantity, unit price **and description**.
  CR-2 ("Replace SKU-B supplier") is a description-only change and is a real change to review.
- Permissions: `canApprove`/`canReject` only checked status. The new `canApproveCr(user, cr)` in
  `common/permissions.ts` checks org + policy scope, and the component ANDs it with
  `status === 'PENDING_APPROVAL'`.

**Task 2: list**
- `visibleRows` filters `state.data` by `statusFilter` ('ALL' = everything). The filter is purely a view
  over loaded data: it never re-fetches and survives a reload.
- New "no match" state (data loaded, but nothing has that status) with a "Show all" button. It is
  distinct from the server-side `empty` state.
- Delta is formatted as money. The selected row is highlighted (`selectedId` input).

**Task 3 / 4: detail**
- Diff table shows description + qty × price on both sides, a totals footer, and a signed delta.
- Timeline is sorted oldest-first on a **copy** of `audit` (no mutation of loaded data). Times are shown in UTC.
- Actions: one `runAction()` handles both Approve and Reject: guard → `submitting = action` → API →
  replace `state` with the server response (or set `actionError`) → clear `submitting`.
- Reject reason: `Validators.required` + a `notBlank` validator (whitespace-only is invalid). The trimmed
  reason is sent. The reason is cleared on success and **kept** on failure so the user doesn't retype it.
- Explicit states: `idle` ("Select a change request"), loading, error + Retry, no line items, no history,
  "read-only access", and "no review actions — this CR is APPLIED".
- `ngOnChanges` reloads when `id` changes. Before, clicking another row in the shell didn't reload the
  detail, which left stale UI.
- `@Output() changed` → the shell reloads the list, so the list never shows a stale status after an action.

## 2. Component & state model

| Component | State | Derived (getters, no stored copies) |
|---|---|---|
| List | `state: ViewState<CrSummary[]>`, `statusFilter`, `@Input selectedId` | `visibleRows` |
| Detail | `state: ViewState<CrDetail>`, `submitting: 'approve' \| 'reject' \| null`, `actionError?`, `rejectControl` | `diff`, `timeline`, `isActionable`, `hasActionPermission`, `canApprove`, `canReject` |

Data flows API → `state` → getters → template. The template only reads named getters/fields, so all
logic is testable without the DOM.

## 3. Invariants I keep

| Invariant | How / where |
|---|---|
| An action is enabled only if status is `PENDING_APPROVAL` **and** the user's policy covers the CR | `canApprove`/`canReject` (component) → `[disabled]` / `*ngIf` (template); re-checked inside `approve()`/`reject()` |
| At most one action request in flight (no double approve) | `submitting` guard at the top of `approve()`/`reject()`. All action buttons are `[disabled]` while set. The guard runs synchronously before the first `await`, so even two clicks in the same tick send one request |
| A failed action never blanks or rolls the view | `runAction` only replaces `state` on success. On failure it sets `actionError` and the CR stays |
| Reject never reaches the API with an empty/blank reason | validators + check in `reject()` (button is disabled too) |
| Responses for a CR that is no longer selected are ignored | `requestSeq` counter checked after every `await` in `load()` and `runAction()` |
| Loaded data is never mutated by the view | timeline sorts a copy; diff builds new rows |
| No blank screen | every `ViewStatus` plus the "no match", "no line items", "no history" and "read-only" cases has explicit markup |

## 4. Testing strategy

- **Component/DOM tests** (TestBed, assert on rendered elements) for list and detail. I drive
  `latencyMs`/`failNext` on the real mock service instead of mocking it, so the tests exercise the
  actual contract. `jest.spyOn` is only used to count/inspect calls (double click, trimmed reason,
  no call when invalid or unpermitted).
- **Pure tests** for `computeDiff`: every kind, each changed field, ordering, empty inputs.
- Covered: list loading/error+retry/empty/no-match/filter/org scoping/selection. Detail
  loading/error+retry/not-found/stale response, diff rows + totals/delta, timeline order + no
  mutation, permissions (org approver, viewer, non-pending, `cr_a_u` owner vs non-owner), approve
  success/slow/double-click/failure+retry, reject validation/success/failure.
- 45 tests. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and Prettier all pass.
- Skipped: tests for the demo shell (`app.component`); it's glue.

## 5. Assumptions

- **Reject uses the approve policies.** The convention has no separate reject action. A reviewer who may
  approve may also reject.
- **`cr_a_w` is treated as org scope.** CRs carry no workspace id, so I can't scope narrower.
- **`cr_a_u` = CRs the user raised**, identified by the `CREATE` audit entry (the model has no owner field).
  I didn't add a "no self-approval" rule. That's a business decision I'd confirm with product.
- **Read-only users see Approve disabled** (with a "read-only access" note) rather than hidden, so the
  reason is visible. The reject form is hidden, because a textarea they can't use is noise. Non-pending
  CRs show no action controls at all, just the status message.
- Action timestamp is the client clock (`new Date().toISOString()`), as the mock API expects `at`.
- After an action, the list reloads fully (shows its loading state briefly). That's acceptable at this size.

## 6. Where I used AI

I used Claude (AI assistant) alot in this task, the brief said its allowed so I was open with it.
First I used it to understand the scaffold and the brief faster, the models / fixtures / mock api etc.
Then it helped me write most of the code, the diff fix, the permissions helper, approve and reject flow in the detail page and the list filter. also the new css styling.
Most of the tests also was drafted with it, I went over them to make sure they test what the user actualy sees (disabled buttons, error messages, order of timeline) not internal stuff.
I ran npm test, lint, build and prettier my self and tried the app with the 3 users (approver, viewer, otherOrg).
The decisions in section 5 (assumptions) and how I split the commits are mine.

## 7. What I'd improve with more time

- Refresh the list without flashing the loading state (keep rows while refetching).
- Move the API to Observables + `switchMap` (this would replace the manual `requestSeq` guard) once it's a real HttpClient service.
- Reflect filter + selected CR in the URL (router) so a review link is shareable.
- Confirm dialog for Approve. Optimistic UI was deliberately avoided for a financial approval.
- Accessibility pass (focus management after an action, live region for success).
- A component test for the shell's list↔detail wiring.
