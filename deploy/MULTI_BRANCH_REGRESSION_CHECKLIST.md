# LOFT №8 Multi-Branch Regression Checklist

Use this checklist before rollout of the 3-branch setup:

- LoftN8 Garden
- LoftN8 Nekazanka
- LoftN8 Žižkov

The goal is to confirm:

- branch isolation works
- guest flow works inside the selected branch
- staff flow works only inside the staff member's branch
- push/polling/realtime events do not leak between branches
- legacy Žižkov/pilot compatibility does not break the current working flow

## Before Testing

1. Seed and restart backend:

```bash
cd /Users/iuriievteev/Desktop/loftn8-app/server
npx prisma generate
npx prisma db push
npm run prisma:seed
```

2. Start local apps or confirm deployed backend/frontend are on the latest branch-aware build.

3. Clear browser site data before each full branch pass:

- guest browser/site data
- staff browser/site data
- especially if reusing the same browser for multiple branches

4. Prepare 2 browser contexts:

- one guest context
- one staff context

5. Use one branch at a time for the first pass.

## Branch Matrix

Run the same checklist for:

- `loft-garden`
- `loft-nekazanka`
- `loft-zizkov`

## 1. Guest Entry

For each branch:

1. Open `/`
2. Select the branch
3. Press `Continue`
4. Confirm auth screen shows the correct branch name
5. Confirm guest can switch back to `/` and choose another branch

Expected:

- selected branch persists
- UI visibly shows the chosen branch
- no silent fallback to another branch

## 2. Guest Auth

For each branch:

1. Register/sign in as guest
2. Complete OTP flow
3. Land on `/menu`

Expected:

- auth succeeds inside the selected branch
- after auth, guest stays in the same branch
- header shows correct branch

## 3. Table Session

For each branch:

1. Go to `/table`
2. Enter table code like `T1`
3. Join table
4. Reload page
5. Confirm session restores

Expected:

- table session belongs to the selected branch
- restoring session does not cross into another branch
- changing branch clears old table session

## 4. QR-Ready Routes

For each branch:

1. Open `/b/<branchSlug>`
2. Confirm redirect to `/auth`
3. Open `/b/<branchSlug>/t/T1`
4. Confirm redirect to `/t/T1`
5. Confirm chosen branch is preserved

Expected:

- valid branch slug works
- invalid branch slug returns to branch selection instead of silently using Žižkov

## 5. Menu Isolation

For each branch:

1. Open `/menu`
2. Confirm menu loads
3. Confirm branch header is correct

Expected:

- menu loads only for the chosen branch
- no 404/500/branch mismatch
- no silent menu from another branch

## 6. Guest Order Request

For each branch:

1. Guest selects an item and presses `Order`
2. Confirm order request success
3. Staff of the same branch opens `Summary` and `Orders`

Expected:

- only staff of the same branch sees the new order request
- staff of other branches sees nothing

## 7. Guest Calls

For each branch:

1. Guest presses `Call waiter`
2. Guest presses `Urgent hookah service`
3. Guest sends a text message
4. Staff of the same branch opens `/staff/calls`

Expected:

- all three call types appear for the correct branch
- push arrives only to the correct branch staff
- other branches do not receive or display these calls

## 8. Payment Flow

For each branch:

1. Guest opens cart
2. Guest requests payment
3. Staff of the same branch opens `/staff/payments`
4. Confirm or cancel payment

Expected:

- payment request appears only in the correct branch
- no cross-branch payment visibility

## 9. Staff Login Isolation

For each branch:

1. Open `/staff/login`
2. Select branch
3. Log in with staff account for that branch

Expected:

- login succeeds only for the correct branch credentials
- logging into a different branch with the wrong branch selection fails
- staff header clearly shows the current branch

## 10. Staff Dashboard Isolation

For each branch:

1. Open:
   - `/staff/summary`
   - `/staff/orders`
   - `/staff/calls`
   - `/staff/payments`
   - `/staff/admin` if role allows

Expected:

- every screen shows only branch-specific data
- counts match actual actions created in that branch
- no stale records from another branch

## 11. Push / Realtime Isolation

For each branch:

1. Log in staff for Branch A
2. Enable notifications
3. Trigger guest action in Branch A
4. Confirm staff A receives push
5. Trigger guest action in Branch B
6. Confirm staff A does not react

Expected:

- push payload belongs only to the correct branch
- client ignores foreign branch push events

## 12. Branch Switching Safety

Guest:

1. Select Branch A
2. Join table
3. Switch to Branch B

Expected:

- old guest session is disconnected
- old table code is cleared
- guest does not keep working in Branch A invisibly

Staff:

1. Log in to Branch A
2. Log out
3. Go to `/staff/login`
4. Select Branch B
5. Log in with Branch B staff

Expected:

- old staff session does not survive branch switch
- no cross-branch cookie reuse

## 13. Legacy Žižkov Compatibility

Check:

- legacy `pilot` data still resolves to Žižkov
- public slug is `loft-zizkov`
- existing Žižkov flow still works end-to-end

Expected:

- no duplicate parallel “pilot” branch in UI flow
- Žižkov remains stable for current working users

## 14. Release Gate

Do not roll out all three branches until all statements below are true:

- guest branch selection works
- staff branch selection works
- branch is visible in guest UI
- branch is visible in staff UI
- order requests are branch-isolated
- calls are branch-isolated
- payments are branch-isolated
- push events are branch-isolated
- session restore is branch-safe
- branch switch clears old session state
- invalid branch slug does not silently fallback

## Recommended Final Smoke Test

Run one full scenario per branch:

1. Guest chooses branch
2. Guest authenticates
3. Guest joins table
4. Guest sends order request
5. Guest sends waiter call
6. Staff of same branch receives both
7. Staff saves order
8. Guest sees order in cart
9. Guest requests payment
10. Staff confirms payment

Pass criteria:

- all 10 steps succeed
- no data appears in the other two branches
