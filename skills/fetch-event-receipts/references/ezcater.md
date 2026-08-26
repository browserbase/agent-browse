# Retrieve an ezCater receipt

Read this reference only for ezCater receipt retrieval.

Use semantic snapshots rather than hard-coded selectors. Re-snapshot after
every click, navigation, or re-render because element refs expire.

Start at `https://www.ezcater.com`.

1. Confirm the page is authenticated. A sign-in screen, account chooser,
   CAPTCHA, SSO prompt, or one-time-code prompt is an authentication escalation.
2. Select the **Receipts** tab.
3. Find the candidate order on the target date.
4. Verify the final order date, independently established currency, and final
   total against the Ramp transaction.
5. Select **PDF** in the row's second column and wait for the download to
   complete.

Do not use an estimate, subtotal, pre-tip total, or authorization hold. If
multiple orders share the same date and final total, report every candidate
order ID and stop.

The emailed receipt and Concur integration are alternative delivery paths, not
part of this skill. If the Receipts tab only offers an asynchronous email for
the target account, stop and report that requirement.

Reference:
<https://help.ezcater.io/en/articles/11594405-where-do-i-find-my-receipt>
