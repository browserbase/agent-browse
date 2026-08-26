# Retrieve an Instacart receipt

Read this reference only for Instacart receipt retrieval.

Use semantic snapshots rather than hard-coded selectors. Re-snapshot after
every click, navigation, or re-render because element refs expire.

Start at `https://www.instacart.com`.

1. Confirm the page is authenticated. A sign-in screen, account chooser,
   CAPTCHA, SSO prompt, or one-time-code prompt is an authentication escalation.
2. Select **Your orders**.
3. Open the candidate order or **View order detail**.
4. Select **Receipt** or **View Receipt**.
5. In **Charges**, use **Total Charged** after adjustments and refunds—not the
   original estimate or authorization hold.
6. Verify the final order date, independently established currency, and Total
   Charged against the Ramp transaction.

Instacart may not expose a direct download control for an individual personal
receipt. When the final receipt is fully rendered, use the screenshot fallback
from the main skill. For an Instacart Business account, **Export** can produce
PDF/CSV receipt history through an email link; do not start that asynchronous
path unless the user requested a batch export and an authorized inbox workflow
is available.

Tips changed after delivery can appear as a separate card charge. If the Ramp
amount does not equal the displayed Total Charged, stop rather than combining
or splitting charges heuristically. If multiple orders share the same date and
final total, report every candidate order ID and stop.

References:

- <https://www.instacart.com/help/section/866017999>
- <https://www.instacart.com/help/section/3375565582/3216676979/xzhhlrtwc>
