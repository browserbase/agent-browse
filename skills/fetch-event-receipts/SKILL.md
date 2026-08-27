---
name: fetch-event-receipts
description: "Fetch a DoorDash event receipt in an authenticated Browserbase session and optionally attach it to its Ramp card transaction. Use for the Ramp Agent Identity + Browserbase receipt demo, DoorDash receipt retrieval, or a missing DoorDash receipt. Do not use for ordering food, reimbursements, other merchants, or invoices."
license: MIT
compatibility: "Requires browse CLI 0.9.5+, Ramp CLI 0.2.24+, Bash, Node.js 20+, jq, file, Poppler, Tesseract, and authenticated Browserbase and Ramp accounts."
allowed-tools: Bash Read Grep
---

# Fetch event receipts

This skill is a narrated runbook, not a one-shot controller. Run every numbered
command separately. Before each command, tell the user what is about to happen;
after it returns, state the observed result. Never hide the whole workflow in a
generated shell script or a single long background command.

Two bundled utilities remain because they are awkward to express as ordinary
CLI calls:

- `scripts/live-view.mjs` serves the local branded Browserbase viewer.
- `scripts/print-doordash-receipt.mjs` calls CDP `Page.printToPDF` for the
  already-open DoorDash order and shrinks output only when Ramp's 3 MiB limit
  requires it. It does not inspect receipt text.

## Interpret the request naturally

Do not demand an exact year or cents before starting this demo.

- Interpret `8/18` as August 18 in the current calendar year.
- Interpret `~$50`, `about $50`, or `$50-ish` as a 4500–5500-cent discovery
  range.
- If exactly one Ramp candidate remains, use Ramp's exact amount from then on.
- Retrieval is the default. Upload only when the prompt says `attach` or
  `upload`.
- Ask only when discovery produces zero or multiple candidates.

The local demo may have a private target registry at:

```bash
demo_registry="$HOME/.config/fetch-event-receipts/demo-targets.json"
```

The registry is operator configuration, not a skill asset. When it is an
owner-only mode-600 file, select one record matching the normalized date and
amount hint. It may supply `transaction_uuid` and `order_url` so the demo can
avoid fragile list-page crawling. Never print or publish those values. If no
registry record exists, use Ramp transaction search and the DoorDash Orders UI.

## 1. Prepare a private run directory

Narrate: “I’ll resolve the Ramp transaction, open its DoorDash receipt in
Browserbase, print it to PDF, and attach it only if requested.”

Resolve the absolute directory containing this `SKILL.md` as `skill_root`, then
run:

```bash
run_dir="$(mktemp -d "${TMPDIR:-/tmp}/fetch-event-receipt.XXXXXX")"
chmod 700 "$run_dir"
ramp_config_home="$HOME/.config/ramp-agents/catering-receipt-agent"
session_id_file="$run_dir/browserbase-session-id"
viewer_ready_file="$run_dir/viewer-ready.json"
receipt_pdf="$run_dir/doordash-receipt.pdf"
: >"$session_id_file"
chmod 600 "$session_id_file"
```

Load only `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` from the approved
workspace secret store if they are not already exported. Never print them, and
never source an unrelated full environment file.

## 2. Resolve the private demo target

Narrate: “I’m using 8/18 in the current year and the bounded $45–$55 range to
find one target.”

For a configured demo target:

```bash
target_date="$(date +%Y)-08-18"
target_record="$(jq -cer --arg date "$target_date" '
  [.targets[]
    | select(
        .merchant == "doordash"
        and .date == $date
        and .amount_hint_minor == 5000
        and .amount_tolerance_minor == 500
      )]
  | if length == 1 then .[0] else error("demo target not unique") end
' "$demo_registry")"
transaction_uuid="$(jq -er '.transaction_uuid' <<<"$target_record")"
doordash_order_url="$(jq -er '
  .order_url
  | select(test("^https://www\\.doordash\\.com/orders/[0-9A-Fa-f-]{36}/?$"))
' <<<"$target_record")"
```

Do not display either private value. If this branch is unavailable, search
cleared Ramp transactions for `DOORDASH` on the normalized date and keep only
amounts inside the stated range. Never choose the closest candidate.

## 3. Read the Ramp transaction

Narrate: “I found one candidate; I’m asking Ramp for its authoritative merchant,
currency, and exact total.”

```bash
ramp_get_payload="$(jq -cn --arg id "$transaction_uuid" \
  --arg rationale 'Verify the DoorDash transaction before fetching its receipt.' \
  '{id:$id,rationale:$rationale}')"
ramp_detail="$(XDG_CONFIG_HOME="$ramp_config_home" \
  ramp --env production --agent transactions get --json "$ramp_get_payload" \
  | sed -n '/^[[:space:]]*{/,$p')"
target_amount_minor="$(jq -er --arg id "$transaction_uuid" '
  [.. | objects | select(.id? == $id) | .amount_decimal? // empty][0]
  | select(type == "string" and test("^[0-9]+(\\.[0-9]{1,2})?$"))
  | split(".") as $parts
  | ($parts[0] | tonumber) * 100
    + (($parts[1] // "") + "00" | .[0:2] | tonumber)
' <<<"$ramp_detail")"
```

For the canned demo, narrate the promoted exact amount—for example, “Ramp
resolved the approximate request to exactly $50.99.” If attaching, use a fresh
Ramp list read to confirm `receipt_uuids` is empty. Stop if any receipt UUID is
already present; this prevents the duplicate-retry failure mode.

## 4. Start the local viewer

Narrate: “I’m opening the Browserbase live view so you can watch the receipt
retrieval.”

Run the viewer in the background; it is the only background process:

```bash
node "$skill_root/scripts/live-view.mjs" \
  --session-id-file "$session_id_file" \
  --ready-file "$viewer_ready_file" \
  --port 0 >"$run_dir/viewer.log" 2>&1 &
viewer_pid=$!
```

Wait until `viewer_ready_file` exists, then open its private loopback URL:

```bash
viewer_url="$(jq -er '.url' "$viewer_ready_file")"
open "$viewer_url"
```

Never print that tokenized loopback URL.

## 5. Create Browserbase and open DoorDash

Narrate: “I’m creating one recorded Browserbase session with the saved
`catering-agent` DoorDash login.”

```bash
session_json="$(browse cloud sessions create \
  --context-id catering-agent \
  --persist \
  --timeout 900 \
  --no-log-session \
  --record-session \
  --body '{"userMetadata":{"workflow":"fetch-event-receipts"}}' \
  | sed -n '/^[[:space:]]*{/,$p')"
browserbase_session_id="$(jq -er '.id' <<<"$session_json")"
connect_url="$(jq -er '.connectUrl' <<<"$session_json")"
printf '%s\n' "$browserbase_session_id" >"$session_id_file"
chmod 600 "$session_id_file"
```

Immediately give the user the clickable session URL:

```text
https://www.browserbase.com/sessions/<browserbase_session_id>
```

Keep `connect_url` private. Open the authenticated browser, then the configured
order in two visible commands:

```bash
driver_session="event-receipt-${browserbase_session_id%%-*}"
browse open https://www.doordash.com \
  --cdp "$connect_url" \
  --session "$driver_session"
```

Narrate: “DoorDash is authenticated; I’m opening the matching completed order.”

```bash
browse open "$doordash_order_url" \
  --session "$driver_session" \
  --wait domcontentloaded \
  --timeout 30000
```

Take a snapshot or visible text read and narrate the observed completed order
and exact total. Do not add a second PDF text validator; Ramp validates the
uploaded receipt.

## 6. Print the open order to PDF

Narrate: “The matching DoorDash order is open; I’m printing this exact tab to a
PDF for Ramp.”

```bash
driver_status="$(browse status --session "$driver_session")"
target_id="$(jq -er '.selectedTargetId' <<<"$driver_status")"
BROWSERBASE_CONNECT_URL="$connect_url" \
  node "$skill_root/scripts/print-doordash-receipt.mjs" \
  --target-id "$target_id" \
  --output "$receipt_pdf"
```

The helper should return `ok: true`. It checks only that printing produced a
non-empty private PDF and reduces size when necessary for Ramp's hard limit.

## 7. Attach with the Ramp CLI

Skip this section for retrieval-only requests. Narrate: “I have the DoorDash
PDF; I’m attaching it to the exact Ramp transaction now.”

Run these as two commands so the upload remains easy to follow:

```bash
receipt_base64="$(base64 <"$receipt_pdf" | tr -d '\r\n')"
```

```bash
upload_json="$(XDG_CONFIG_HOME="$ramp_config_home" \
  ramp --env production --no-input --agent receipts upload \
  --content_type application/pdf \
  --filename doordash-receipt.pdf \
  --file_content_base64 "$receipt_base64" \
  --transaction_uuid "$transaction_uuid" \
  --rationale 'Attach the matched DoorDash receipt to the verified Ramp transaction.' \
  | sed -n '/^[[:space:]]*{/,$p')"
unset receipt_base64
receipt_uuid="$(jq -er '
  .data[0]
  | select(.attached_to_transaction == true)
  | .receipt_uuid
  | select(type == "string")
' <<<"$upload_json")"
```

Ramp success is `data[0].attached_to_transaction == true` with a receipt UUID.
Narrate that observed result; do not retry an ambiguous response. Return the
clickable Ramp transaction URL and Browserbase session URL.

## 8. Clean up

Narrate: “The receipt is attached; I’m closing the browser session and local
viewer.”

```bash
browse stop --session "$driver_session"
browse cloud sessions update "$browserbase_session_id" --status REQUEST_RELEASE
: >"$session_id_file"
kill "$viewer_pid"
```

Never delete an unknown process or session. Keep the private PDF only long
enough for the run; tell the user where it is if retrieval-only was requested.
