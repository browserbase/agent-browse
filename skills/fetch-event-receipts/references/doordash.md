# Retrieve a DoorDash receipt

Read this reference only for DoorDash receipt retrieval.

Use semantic snapshots rather than hard-coded selectors. Re-snapshot after
every click, navigation, or re-render because element refs expire.

Start at `https://www.doordash.com` and use the account menu rather than
guessing an order-detail URL.

1. Confirm the page is authenticated. A sign-in screen, account chooser,
   CAPTCHA, SSO prompt, or one-time-code prompt is an authentication escalation.
2. Select **Orders** from the account menu.
3. Find the candidate on the target date and open it.
4. Select **View Receipt**.
5. Verify the completed order date, independently established currency, and
   final total against the Ramp transaction.
6. Select **Download receipt**.

Do not use an estimated subtotal, pre-tip total, authorization hold, or an
individual participant's split when DoorDash charged an aggregate group-order
total. If multiple orders share the same date and final total, report every
candidate order ID and stop; restaurant name alone does not break the tie.

DoorDash may return an empty download archive even while the complete final
receipt remains rendered. Revalidate the rendered receipt and use the
screenshot fallback from the main skill rather than treating an invalid archive
as a receipt.

Reference:
<https://help.doordash.com/en-us/consumers/article/how-do-i-receive-a-receipt-for-my-order>
