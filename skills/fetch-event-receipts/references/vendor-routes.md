# Vendor receipt routes

Use semantic snapshots rather than hard-coded selectors. Portal layouts drift;
the visible labels below are the stable intent. Re-snapshot after every click or
navigation.

## Common candidate procedure

1. Confirm the page is authenticated. A sign-in screen, account chooser,
   CAPTCHA, SSO prompt, or one-time-code prompt is an authentication escalation.
2. Open order history or receipts.
3. Restrict visually to the target date where the portal supports it.
4. Open candidate order details and read the final total and currency.
5. Match supported platform, exact calendar date, currency, and exact amount in
   integer minor units.
6. Continue only when exactly one candidate matches.

Do not use an estimated subtotal, authorization hold, pre-tip total, or an
individual store receipt when the platform charged an aggregate total.

## DoorDash

Start at `https://www.doordash.com` and use the account menu rather than guessing
an order-detail URL.

Official desktop route:

1. Select **Orders** from the menu.
2. Select the candidate order.
3. Select **View Receipt**.
4. Verify date and final total against Ramp.
5. Select **Download Receipt**.

If multiple orders share the same date and total, report every candidate order
ID and stop. Do not use restaurant name alone to break the tie.

Reference: <https://help.doordash.com/en-us/consumers/article/how-do-i-receive-a-receipt-for-my-order>

## ezCater

Start at `https://www.ezcater.com`.

Official account route:

1. Select the **Receipts** tab.
2. Find the candidate order row.
3. Verify date and final total against Ramp.
4. Select **PDF** in the row's second column; the PDF downloads automatically.

The emailed receipt and Concur integration are alternative delivery paths, not
part of this skill. If the Receipts tab only offers an asynchronous email for
the target account, stop and report that requirement.

Reference: <https://help.ezcater.io/en/articles/11594405-where-do-i-find-my-receipt>

## Instacart

Start at `https://www.instacart.com`.

Official website route:

1. Select **Your orders**.
2. Open the candidate order or **View order detail**.
3. Select **Receipt** / **View Receipt**.
4. In the receipt's Charges section, use **Total Charged** after adjustments and
   refunds—not the original estimate or authorization hold.
5. Verify date, currency, and final total against Ramp.

Instacart may not expose a direct download control for an individual personal
receipt. When the final receipt is fully rendered, capture it with
`browse screenshot --full-page --path <receipt.png>` and upload the PNG. For an
Instacart Business account, **Export** can produce PDF/CSV receipt history via an
email link; do not start that asynchronous path unless the user asked for a
batch export and an authorized inbox workflow is available.

Tips changed after delivery can appear as a separate card charge. If the Ramp
amount does not equal the displayed Total Charged, stop rather than combining or
splitting charges heuristically.

References:

- <https://www.instacart.com/help/section/866017999>
- <https://www.instacart.com/help/section/3375565582/3216676979/xzhhlrtwc>
