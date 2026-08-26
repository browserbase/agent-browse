# Retrieve a DoorDash receipt

Read this reference only after the parent skill has acquired the
`catering-agent` lock, created the private working directory and Browserbase
session, and attached the named Browse driver. This reference owns only the
DoorDash portion of the run:

- prove the saved DoorDash login is usable;
- find exactly one completed order by charged date and exact USD amount;
- validate the final receipt view;
- try the bounded Browserbase download path;
- fall back to a tightly clipped receipt-panel image when needed; and
- return one private artifact path or one sanitized hard-stop code.

Do not create or release Browserbase sessions here. Do not acquire or remove the
context lock, call Ramp, or perform the parent's final cleanup. Never reorder,
change the account, contact support, request a refund, or click any control
unrelated to viewing the one matching receipt.

## Output boundary

On success, leave exactly one supported file in `receipt_workdir`, set
`receipt_path` to it, set `doordash_artifact_method` to `download` or
`receipt_panel_screenshot`, and return control to the parent without printing
the path or receipt contents.

On failure, leave `receipt_path` unset and return one machine-readable object to
the parent. It must contain only the stage and a code from the failure table:

```bash
doordash_hard_stop() {
  local stage="$1"
  local code="$2"
  local cleanup_file
  unset receipt_path
  if [[ -n "${receipt_workdir:-}" ]]; then
    for cleanup_file in "${ocr_path:-}" "${candidate_path:-}" \
      "${archive_path:-}"; do
      if [[ -n "$cleanup_file" \
        && "$cleanup_file" == "$receipt_workdir/"* \
        && -f "$cleanup_file" ]]; then
        : >"$cleanup_file"
        rm -f -- "$cleanup_file"
      fi
    done
  fi
  jq -cn --arg stage "$stage" --arg code "$code" \
    '{ok:false, stage:$stage, code:$code}' >&2
  exit 1
}
```

`exit 1` deliberately triggers the parent's registered `EXIT` cleanup trap.
Remove DoorDash-only intermediates after deriving the result. Leave driver and
remote-session release to the parent's registered cleanup path.

## Assumptions and inputs

The parent has already set:

- `transaction_date`: charged/placed date in `YYYY-MM-DD`.
- `target_amount_minor`: exact final USD amount as integer cents.
- `target_currency`: authoritative Ramp currency; this reference supports only
  `USD`.
- `receipt_workdir`: private per-run directory.
- `browserbase_session_id`: private Browserbase session ID.
- `driver_session`: attached Browse driver name.

Validate the values before placing any of them in JavaScript. Convert the date
to a JSON string with `jq`; never interpolate an unvalidated page value into
shell or browser code:

```bash
[[ "$transaction_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  doordash_hard_stop doordash_match invalid_target_date
}
[[ "$target_amount_minor" =~ ^[0-9]+$ ]] || {
  doordash_hard_stop doordash_match invalid_target_amount
}
[[ "$target_currency" == 'USD' ]] || {
  doordash_hard_stop doordash_match currency_unsupported
}
[[ -d "$receipt_workdir" ]] || {
  doordash_hard_stop download private_workdir_missing
}

target_date_json="$(jq -Rn --arg value "$transaction_date" '$value')"
target_amount_text="$(printf '$%d.%02d' \
  "$((10#$target_amount_minor / 100))" \
  "$((10#$target_amount_minor % 100))")"
target_amount_text_json="$(jq -Rn --arg value "$target_amount_text" '$value')"
```

Every `browse eval` below returns only booleans, counts, enumerated states, or
geometry. It may inspect private DOM text inside the browser, but must never
return that text. Do not run an unfiltered `browse snapshot` on an Orders or
receipt page: its accessibility tree can expose account, address, payment, and
line-item data. The flow below needs no snapshot. If one is unavoidable for
diagnosis, filter it to one public action label and do not save or pipe it; a raw
snapshot may encode the entire private tree as one line.

## Fast path

```text
authenticated homepage
  -> Orders
  -> scan Personal and Business when both exist
  -> exactly one date + exact-total card
     OR one exact-total discovery card when the list omits a parseable date
  -> that card's View Receipt
  -> final status + date + exact Total + US/USD consistency
  -> Download receipt
  -> one validated downloaded file
     OR one validated semantic receipt-panel screenshot
```

Never guess an order-detail URL or reuse an order identifier from another run.

## 1. Prove authentication without exposing the page

The stable success signal is a visible **Orders** action. The absence of a
sign-in button is not sufficient. Probe only enumerated state:

```bash
auth_probe="$(browse eval '(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && rect.width > 0
      && rect.height > 0;
  };
  const label = (element) => (
    element.getAttribute("aria-label")
    || element.innerText
    || element.textContent
    || ""
  ).replace(/\s+/g, " ").trim();
  const actions = [...document.querySelectorAll(
    "a,button,[role=link],[role=button]"
  )].filter(visible);
  const actionLabels = actions.map(label);
  const body = (document.body?.innerText || "").toLowerCase();
  return {
    onDoorDash: location.hostname === "doordash.com"
      || location.hostname.endsWith(".doordash.com"),
    hasOrders: actionLabels.includes("Orders"),
    hasSignIn: actionLabels.some((value) => /^(sign in|log in)$/i.test(value)),
    hasPassword: Boolean(document.querySelector("input[type=password]")),
    hasOneTimeCode: Boolean(document.querySelector(
      "input[autocomplete=one-time-code]"
    )),
    hasCaptcha: /captcha|verify you are human/.test(body)
  };
})()' --session "$driver_session")"

jq -e '.result.onDoorDash == true' <<<"$auth_probe" >/dev/null \
  || doordash_hard_stop context_auth unexpected_origin

if jq -e '.result.hasSignIn or .result.hasPassword
  or .result.hasOneTimeCode or .result.hasCaptcha' \
  <<<"$auth_probe" >/dev/null; then
  doordash_hard_stop context_auth handoff_required
fi

jq -e '.result.hasOrders == true' <<<"$auth_probe" >/dev/null \
  || doordash_hard_stop context_auth authenticated_orders_unavailable
unset auth_probe
```

SSO, an account chooser, MFA, a one-time-code prompt, CAPTCHA, or an expired
session is always `handoff_required`. Do not guess credentials or retry the same
authentication action.

## 2. Use stable action labels

Use this helper only for the verified public labels `Orders`, `Personal`, and
`Business`. It returns counts and click state, never page text:

```bash
doordash_click_action() {
  local requested_label="$1"
  local label_json expression result
  case "$requested_label" in
    Orders|Personal|Business) ;;
    *) return 2 ;;
  esac

  label_json="$(jq -Rn --arg value "$requested_label" '$value')"
  expression='(() => {
    const wanted = '"$label_json"';
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    };
    const label = (element) => (
      element.getAttribute("aria-label")
      || element.innerText
      || element.textContent
      || ""
    ).replace(/\s+/g, " ").trim();
    const matches = [...document.querySelectorAll(
      "a,button,[role=link],[role=button]"
    )].filter((element) => visible(element) && label(element) === wanted);
    if (matches.length !== 1) {
      return {count: matches.length, clicked: false};
    }
    matches[0].click();
    return {count: 1, clicked: true};
  })()'
  result="$(browse eval "$expression" --session "$driver_session")" || return 1
  jq -e '.result.count == 1 and .result.clicked == true' \
    <<<"$result" >/dev/null
}

doordash_wait_for_receipt_cards() {
  local readiness
  for attempt in {1..20}; do
    readiness="$(browse eval '(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== "none" && style.visibility !== "hidden";
      };
      const label = (element) => (
        element.getAttribute("aria-label")
        || element.innerText
        || element.textContent
        || ""
      ).replace(/\s+/g, " ").trim();
      const receiptActionCount = [...document.querySelectorAll(
        "a,button,[role=link],[role=button]"
      )].filter((element) => (
        visible(element) && label(element) === "View Receipt"
      )).length;
      const body = (document.body?.innerText || "").toLowerCase();
      return {
        receiptActionCount,
        emptyState: /\b(no past orders|no orders yet)\b/.test(body)
      };
    })()' --session "$driver_session")" || return 2
    if jq -e '.result.receiptActionCount > 0 or .result.emptyState == true' \
      <<<"$readiness" >/dev/null; then
      printf '%s\n' "$readiness"
      return 0
    fi
    browse wait timeout 500 --session "$driver_session" >/dev/null || return 2
  done
  return 1
}

doordash_require_receipt_cards() {
  local readiness_status
  if doordash_wait_for_receipt_cards >/dev/null; then
    return 0
  fi
  readiness_status=$?
  if [[ "$readiness_status" == 1 ]]; then
    doordash_hard_stop doordash_match order_surface_not_ready
  fi
  doordash_hard_stop doordash_match order_probe_failed
}
```

Open **Orders**, then allow the single-page app to settle:

```bash
doordash_click_action Orders \
  || doordash_hard_stop doordash_match orders_navigation_failed
```

Refs, hashed CSS classes, pixel coordinates, and direct order URLs are unstable.
Re-evaluate the live DOM after every click, tab switch, viewport change, or
re-render.

## 3. Count exact matches without returning order data

The order list can expose **Personal** and **Business** views. **Group Order** is
receipt metadata and may coexist with **Business**; it is not necessarily a
separate order-history tab.

Define one privacy-safe probe for the active view. It treats each visible
**View Receipt** action as an order-card anchor, walks to the smallest ancestor
that contains only that action, and separately counts exact-total cards and the
subset whose text also contains a supported rendering of the target date. Keep
count-and-click inside one in-page evaluation; a chain of external locator reads
can race a DoorDash re-render between locating a control and using it:

```bash
doordash_order_match() {
  local operation="$1"
  local operation_json expression
  operation_json="$(jq -Rn --arg value "$operation" '$value')"

  expression='(() => {
    const targetDate = '"$target_date_json"';
    const targetMinor = '"$target_amount_minor"';
    const operation = '"$operation_json"';
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    };
    const norm = (value) => (value || "").replace(/\s+/g, " ").trim();
    const label = (element) => norm(
      element.getAttribute("aria-label")
      || element.innerText
      || element.textContent
    );
    const actions = [...document.querySelectorAll(
      "a,button,[role=link],[role=button]"
    )].filter(visible);
    const receiptActions = actions.filter(
      (element) => label(element) === "View Receipt"
    );
    const parsedDate = new Date(`${targetDate}T00:00:00Z`);
    const dateOptions = (monthStyle, includeYear) => ({
      month: monthStyle,
      day: "numeric",
      ...(includeYear ? {year: "numeric"} : {}),
      timeZone: "UTC"
    });
    const year = parsedDate.getUTCFullYear();
    const shortYear = String(year).slice(-2);
    const month = parsedDate.getUTCMonth() + 1;
    const day = parsedDate.getUTCDate();
    const monthPadded = String(month).padStart(2, "0");
    const dayPadded = String(day).padStart(2, "0");
    const ordinal = day % 10 === 1 && day !== 11 ? "st"
      : day % 10 === 2 && day !== 12 ? "nd"
      : day % 10 === 3 && day !== 13 ? "rd" : "th";
    const monthShort = new Intl.DateTimeFormat("en-US", {
      month: "short", timeZone: "UTC"
    }).format(parsedDate);
    const monthLong = new Intl.DateTimeFormat("en-US", {
      month: "long", timeZone: "UTC"
    }).format(parsedDate);
    const dateTokens = new Set([
      targetDate,
      new Intl.DateTimeFormat("en-US", dateOptions("short", true))
        .format(parsedDate),
      new Intl.DateTimeFormat("en-US", dateOptions("long", true))
        .format(parsedDate),
      new Intl.DateTimeFormat("en-US", dateOptions("short", false))
        .format(parsedDate),
      new Intl.DateTimeFormat("en-US", dateOptions("long", false))
        .format(parsedDate),
      `${month}/${day}/${year}`,
      `${monthPadded}/${dayPadded}/${year}`,
      `${month}/${day}/${shortYear}`,
      `${monthPadded}/${dayPadded}/${shortYear}`,
      `${month}/${day}`,
      `${monthPadded}/${dayPadded}`,
      `${year}/${monthPadded}/${dayPadded}`,
      `${year}-${month}-${day}`,
      `${monthPadded}-${dayPadded}-${year}`,
      `${day} ${monthShort} ${year}`,
      `${day} ${monthLong} ${year}`,
      `${monthShort} ${day}${ordinal}`,
      `${monthLong} ${day}${ordinal}`,
      `${monthShort} ${day}${ordinal}, ${year}`,
      `${monthLong} ${day}${ordinal}, ${year}`
    ]);
    const containsDate = (text) => [...dateTokens].some(
      (token) => text.includes(token)
    );
    const amountValues = (text) => [...text.matchAll(
      /\$\s*([0-9]+(?:,[0-9]{3})*)(?:\.([0-9]{1,2}))?/g
    )].map((match) => {
      const whole = Number(match[1].replaceAll(",", ""));
      const fraction = (match[2] || "").padEnd(2, "0").slice(0, 2);
      return whole * 100 + Number(fraction || "0");
    });
    const amountCards = [];
    for (const action of receiptActions) {
      let node = action.parentElement;
      while (node && node !== document.body) {
        const actionCount = [...node.querySelectorAll(
          "a,button,[role=link],[role=button]"
        )].filter((candidate) => (
          visible(candidate) && label(candidate) === "View Receipt"
        )).length;
        const text = norm(node.innerText);
        if (
          actionCount === 1
          && amountValues(text).includes(targetMinor)
        ) {
          amountCards.push({node, action, dateMatch: containsDate(text)});
          break;
        }
        node = node.parentElement;
      }
    }
    const uniqueAmount = [...new Map(
      amountCards.map((entry) => [entry.node, entry])
    ).values()];
    const exact = uniqueAmount.filter((entry) => entry.dateMatch);
    const chosen = operation === "click_exact" && exact.length === 1
      ? exact[0]
      : operation === "click_amount" && exact.length === 0
        && uniqueAmount.length === 1 ? uniqueAmount[0] : null;
    if (chosen) {
      chosen.action.click();
      return {
        candidateCount: exact.length,
        amountCandidateCount: uniqueAmount.length,
        clicked: true
      };
    }
    return {
      candidateCount: exact.length,
      amountCandidateCount: uniqueAmount.length,
      clicked: false
    };
  })()'

  browse eval "$expression" --session "$driver_session"
}
```

First check which account tabs exist, returning booleans only:

```bash
surface_probe=''
for attempt in {1..20}; do
  surface_probe="$(browse eval '(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.display !== "none" && style.visibility !== "hidden";
  };
  const label = (element) => (
    element.getAttribute("aria-label")
    || element.innerText
    || element.textContent
    || ""
  ).replace(/\s+/g, " ").trim();
  const labels = [...document.querySelectorAll(
    "a,button,[role=tab],[role=link],[role=button]"
  )].filter(visible).map(label);
  return {
    hasPersonal: labels.includes("Personal"),
    hasBusiness: labels.includes("Business"),
    receiptActionCount: labels.filter((value) => value === "View Receipt").length
  };
})()' --session "$driver_session")" \
    || doordash_hard_stop doordash_match order_probe_failed
  if jq -e '
    .result.hasPersonal == true or
    .result.hasBusiness == true or
    .result.receiptActionCount > 0
  ' <<<"$surface_probe" >/dev/null; then
    break
  fi
  browse wait timeout 500 --session "$driver_session" >/dev/null
done
jq -e '
  .result.hasPersonal == true or
  .result.hasBusiness == true or
  .result.receiptActionCount > 0
' <<<"$surface_probe" >/dev/null \
  || doordash_hard_stop doordash_match order_surface_not_ready
```

If both tabs exist, scan both even when the initially visible view contains a
match. Keep only the two counts:

```bash
personal_count=0
business_count=0
personal_amount_count=0
business_amount_count=0

if jq -e '.result.hasPersonal == true' <<<"$surface_probe" >/dev/null; then
  doordash_click_action Personal \
    || doordash_hard_stop doordash_match account_surface_unavailable
  browse wait timeout 700 --session "$driver_session" >/dev/null
  doordash_require_receipt_cards
  personal_probe="$(doordash_order_match probe)" \
    || doordash_hard_stop doordash_match order_probe_failed
  personal_count="$(jq -er '.result.candidateCount' <<<"$personal_probe")"
  personal_amount_count="$(jq -er '.result.amountCandidateCount' \
    <<<"$personal_probe")"
  unset personal_probe
fi

if jq -e '.result.hasBusiness == true' <<<"$surface_probe" >/dev/null; then
  doordash_click_action Business \
    || doordash_hard_stop doordash_match account_surface_unavailable
  browse wait timeout 700 --session "$driver_session" >/dev/null
  doordash_require_receipt_cards
  business_probe="$(doordash_order_match probe)" \
    || doordash_hard_stop doordash_match order_probe_failed
  business_count="$(jq -er '.result.candidateCount' <<<"$business_probe")"
  business_amount_count="$(jq -er '.result.amountCandidateCount' \
    <<<"$business_probe")"
  unset business_probe
fi

if jq -e '.result.hasPersonal == false and .result.hasBusiness == false' \
  <<<"$surface_probe" >/dev/null; then
  doordash_require_receipt_cards
  active_probe="$(doordash_order_match probe)" \
    || doordash_hard_stop doordash_match order_probe_failed
  personal_count="$(jq -er '.result.candidateCount' <<<"$active_probe")"
  personal_amount_count="$(jq -er '.result.amountCandidateCount' \
    <<<"$active_probe")"
  unset active_probe
fi
unset surface_probe

total_match_count=$((personal_count + business_count))
total_amount_count=$((personal_amount_count + business_amount_count))
match_mode=''
case "$total_match_count" in
  1) match_mode='exact' ;;
  0)
    case "$total_amount_count" in
      0) doordash_hard_stop doordash_match order_not_found ;;
      1) match_mode='amount_discovery' ;;
      *) doordash_hard_stop doordash_match ambiguous_order_match ;;
    esac
    ;;
  *) doordash_hard_stop doordash_match ambiguous_order_match ;;
esac
```

The amount-only branch is a read-only discovery fallback for a live Orders card
whose date is absent or uses an unknown rendering. It is allowed only when one
and only one exact-total card exists across all account surfaces. The receipt
view must still prove the full target date before the artifact can be accepted;
an adjacent or mismatched date is never auto-matched.

Return to the one matching surface, then recompute and click that card's child
**View Receipt** action. Never use merchant name or a private order identifier
to break a same-date/same-amount tie:

```bash
if [[ "$match_mode" == 'exact' ]]; then
  personal_selected="$personal_count"
  business_selected="$business_count"
  click_operation='click_exact'
else
  personal_selected="$personal_amount_count"
  business_selected="$business_amount_count"
  click_operation='click_amount'
fi

if (( personal_selected == 1 )); then
  # This is a no-op when there are no explicit account tabs.
  doordash_click_action Personal 2>/dev/null || true
elif (( business_selected == 1 )); then
  doordash_click_action Business \
    || doordash_hard_stop doordash_match account_surface_unavailable
fi
browse wait timeout 700 --session "$driver_session" >/dev/null
doordash_require_receipt_cards

open_receipt="$(doordash_order_match "$click_operation")" \
  || doordash_hard_stop doordash_match order_probe_failed
if [[ "$match_mode" == 'exact' ]]; then
  jq -e '.result.candidateCount == 1 and .result.clicked == true' \
    <<<"$open_receipt" >/dev/null \
    || doordash_hard_stop doordash_match order_changed_before_click
else
  jq -e '
    .result.candidateCount == 0 and
    .result.amountCandidateCount == 1 and
    .result.clicked == true
  ' <<<"$open_receipt" >/dev/null \
    || doordash_hard_stop doordash_match order_changed_before_click
fi
[[ "$(jq -r '.result.clicked' <<<"$open_receipt")" == true ]] \
  || doordash_hard_stop doordash_match order_changed_before_click
unset open_receipt personal_count business_count total_match_count
unset personal_amount_count business_amount_count total_amount_count
unset personal_selected business_selected click_operation match_mode
```

## 4. Validate the final receipt view

The authoritative amount is the value associated with **Total**, not
**Subtotal**, **Tax**, **Tip**, a line item, an authorization hold, or an
estimated/pre-tip figure. Prefer **Order complete** as explicit finality. On a
receipt variant where that literal is absent, one visible **Download receipt**
action may establish finality only when the same private panel proves the full
target date, every visible **Total** maps to the exact target amount,
**Payment** is present, and no non-final state signal is present.

The demo supports USD only. A bare `$` is ambiguous on its own. Page-level
currency consistency is sufficient only when all three are true:

1. the parent supplied authoritative Ramp currency `USD`;
2. the browser is on the US `doordash.com` surface; and
3. the selected receipt panel privately contains a US order-location pattern.

The location check returns one boolean and never returns or stores the address.
Use the same semantic-panel probe later for clipping:

```bash
receipt_probe_js='(() => {
  const targetDate = '"$target_date_json"';
  const targetMinor = '"$target_amount_minor"';
  const targetAmountText = '"$target_amount_text_json"';
  const norm = (value) => (value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && rect.width > 0
      && rect.height > 0;
  };
  const label = (element) => norm(
    element.getAttribute("aria-label")
    || element.innerText
    || element.textContent
  );
  const parsedDate = new Date(`${targetDate}T00:00:00Z`);
  const year = parsedDate.getUTCFullYear();
  const shortYear = String(year).slice(-2);
  const month = parsedDate.getUTCMonth() + 1;
  const day = parsedDate.getUTCDate();
  const monthPadded = String(month).padStart(2, "0");
  const dayPadded = String(day).padStart(2, "0");
  const ordinal = day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const monthShort = new Intl.DateTimeFormat("en-US", {
    month: "short", timeZone: "UTC"
  }).format(parsedDate);
  const monthLong = new Intl.DateTimeFormat("en-US", {
    month: "long", timeZone: "UTC"
  }).format(parsedDate);
  const dateTokens = new Set([
    targetDate,
    new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
    }).format(parsedDate),
    new Intl.DateTimeFormat("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
    }).format(parsedDate),
    `${month}/${day}/${year}`,
    `${monthPadded}/${dayPadded}/${year}`,
    `${month}/${day}/${shortYear}`,
    `${monthPadded}/${dayPadded}/${shortYear}`,
    `${month}/${day}`,
    `${monthPadded}/${dayPadded}`,
    `${year}/${monthPadded}/${dayPadded}`,
    `${year}-${month}-${day}`,
    `${monthPadded}-${dayPadded}-${year}`,
    `${day} ${monthShort} ${year}`,
    `${day} ${monthLong} ${year}`,
    `${monthShort} ${day}${ordinal}`,
    `${monthLong} ${day}${ordinal}`,
    `${monthShort} ${day}${ordinal}, ${year}`,
    `${monthLong} ${day}${ordinal}, ${year}`
  ]);
  const containsDate = (text) => [...dateTokens].some(
    (token) => text.includes(token)
  );
  const amountValues = (text) => [...text.matchAll(
    /\$\s*([0-9]+(?:,[0-9]{3})*)(?:\.([0-9]{1,2}))?/g
  )].map((match) => {
    const whole = Number(match[1].replaceAll(",", ""));
    const fraction = (match[2] || "").padEnd(2, "0").slice(0, 2);
    return whole * 100 + Number(fraction || "0");
  });
  const actions = [...document.querySelectorAll(
    "a,button,[role=link],[role=button]"
  )].filter(visible);
  const downloadActions = actions.filter(
    (element) => label(element) === "Download receipt"
  );
  if (downloadActions.length !== 1) {
    return {
      panelFound: false,
      downloadActionCount: downloadActions.length,
      finalStatus: false,
      dateMatch: false,
      totalMatch: false,
      orderLocationUS: false,
      hostUS: location.hostname === "doordash.com"
        || location.hostname.endsWith(".doordash.com"),
      splitSignals: false,
      groupOrder: false,
      privacyScoped: false,
      geometry: null
    };
  }
  const candidates = [];
  for (let node = downloadActions[0]; node && node !== document.body;
    node = node.parentElement) {
    const text = norm(node.innerText);
    const rect = node.getBoundingClientRect();
    const totalLabels = [...node.querySelectorAll("*")].filter(
      (element) => visible(element) && label(element) === "Total"
    );
    const targetTotalRows = totalLabels.filter((element) => {
      let row = element.parentElement;
      for (let depth = 0; row && depth < 4; depth += 1, row = row.parentElement) {
        if (amountValues(norm(row.innerText)).includes(targetMinor)) return true;
      }
      return false;
    });
    const allTotalRowsMatch = totalLabels.length >= 1
      && targetTotalRows.length === totalLabels.length;
    const nonFinalSignals = /\b(?:order (?:pending|processing|scheduled|cancelled|canceled|refunded)|payment (?:pending|processing)|estimated total|authorization hold|pre[- ]?authorization)\b/i
      .test(text);
    const actionCount = [...node.querySelectorAll(
      "a,button,[role=link],[role=button]"
    )].filter((element) => (
      visible(element) && label(element) === "Download receipt"
    )).length;
    if (
      actionCount === 1
      && rect.width > 0
      && rect.height > 0
      && containsDate(text)
      && allTotalRowsMatch
      && text.includes("Payment")
      && !nonFinalSignals
    ) {
      candidates.push({
        node,
        rect,
        text,
        totalLabels,
        targetTotalRowCount: targetTotalRows.length,
        allTotalRowsMatch,
        nonFinalSignals,
        explicitFinalStatus: text.includes("Order complete")
      });
    }
  }
  const chosen = candidates
    .filter(({node}) => !["HTML", "BODY", "MAIN"].includes(node.tagName))
    .sort((left, right) => (
      left.rect.width * left.rect.height - right.rect.width * right.rect.height
    ))[0];
  if (!chosen) {
    return {
      panelFound: false,
      downloadActionCount: 1,
      finalStatus: false,
      dateMatch: false,
      totalMatch: false,
      orderLocationUS: false,
      hostUS: location.hostname === "doordash.com"
        || location.hostname.endsWith(".doordash.com"),
      splitSignals: false,
      groupOrder: false,
      privacyScoped: false,
      geometry: null
    };
  }
  const usStateAndZip = /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s+\d{5}(?:-\d{4})?\b/;
  let orderLocationUS = false;
  for (let node = chosen.node; node; node = node.parentElement) {
    const text = norm(node.innerText);
    const downloadCount = [...node.querySelectorAll(
      "a,button,[role=link],[role=button]"
    )].filter((element) => (
      visible(element) && label(element) === "Download receipt"
    )).length;
    if (
      downloadCount === 1
      && containsDate(text)
      && amountValues(text).includes(targetMinor)
      && usStateAndZip.test(text)
    ) {
      orderLocationUS = true;
      break;
    }
    if (node === document.body) break;
  }
  const splitSignals = /\b(participant|organizer|your (?:share|portion)|split total|group total)\b/i
    .test(chosen.text);
  const unrelatedOrderActions = [...chosen.node.querySelectorAll(
    "a,button,[role=link],[role=button]"
  )].filter((element) => (
    visible(element) && label(element) === "View Receipt"
  )).length;
  const unrelatedNavigationActions = [...chosen.node.querySelectorAll(
    "a,button,[role=tab],[role=link],[role=button]"
  )].filter((element) => (
    visible(element)
    && ["Orders", "Personal", "Business", "Past Orders"]
      .includes(label(element))
  )).length;
  const rect = chosen.node.getBoundingClientRect();
  return {
    panelFound: true,
    downloadActionCount: 1,
    finalStatus: chosen.explicitFinalStatus || (
      downloadActions.length === 1
      && chosen.allTotalRowsMatch
      && !chosen.nonFinalSignals
    ),
    finalityViaDownload: !chosen.explicitFinalStatus,
    nonFinalSignals: chosen.nonFinalSignals,
    dateMatch: containsDate(chosen.text),
    totalMatch: chosen.allTotalRowsMatch
      && chosen.text.includes(targetAmountText),
    receiptLabels: ["Total", "Payment"]
      .every((value) => chosen.text.includes(value)),
    orderLocationUS,
    hostUS: location.hostname === "doordash.com"
      || location.hostname.endsWith(".doordash.com"),
    splitSignals,
    groupOrder: chosen.text.includes("Group Order"),
    business: chosen.text.includes("Business"),
    privacyScoped: unrelatedOrderActions === 0
      && unrelatedNavigationActions === 0
      && rect.width < window.innerWidth * 0.9,
    totalLabelCount: chosen.totalLabels.length,
    targetTotalRowCount: chosen.targetTotalRowCount,
    geometry: {
      x: Math.max(0, Math.floor(rect.left + window.scrollX)),
      y: Math.max(0, Math.floor(rect.top + window.scrollY)),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
      clientHeight: Math.ceil(chosen.node.clientHeight),
      scrollHeight: Math.ceil(chosen.node.scrollHeight),
      viewportWidth: window.innerWidth,
      requiredViewportHeight: Math.ceil(
        chosen.node.scrollHeight + Math.max(0, rect.top) + 64
      )
    }
  };
})()'

receipt_probe=''
for attempt in {1..20}; do
  receipt_probe="$(browse eval "$receipt_probe_js" \
    --session "$driver_session")" \
    || doordash_hard_stop doordash_match receipt_probe_failed
  if jq -e '.result.panelFound == true' <<<"$receipt_probe" >/dev/null; then
    break
  fi
  browse wait timeout 500 --session "$driver_session" >/dev/null
done

jq -e '
  .result.panelFound == true and
  .result.downloadActionCount == 1 and
  .result.finalStatus == true and
  .result.dateMatch == true and
  .result.totalMatch == true and
  .result.receiptLabels == true and
  .result.privacyScoped == true
' <<<"$receipt_probe" >/dev/null \
  || doordash_hard_stop doordash_match receipt_not_final_or_mismatched

jq -e '.result.hostUS == true and .result.orderLocationUS == true' \
  <<<"$receipt_probe" >/dev/null \
  || doordash_hard_stop doordash_match currency_unverified

jq -e '
  .result.totalLabelCount >= 1 and
  .result.targetTotalRowCount == .result.totalLabelCount and
  .result.splitSignals == false and
  .result.nonFinalSignals == false
' \
  <<<"$receipt_probe" >/dev/null \
  || doordash_hard_stop doordash_match split_total_ambiguous
```

**Business** and **Group Order** may legitimately coexist. Their presence alone
is not ambiguous. If the page exposes participant/organizer or multiple charged
totals and the target charge cannot be mapped to exactly one final **Total**,
stop with `split_total_ambiguous`; never substitute a group subtotal or a
participant share by guesswork.

## 5. Try the bounded download path

Click the one semantic **Download receipt** action without returning its text:

```bash
download_click="$(browse eval '(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.display !== "none" && style.visibility !== "hidden";
  };
  const label = (element) => (
    element.getAttribute("aria-label")
    || element.innerText
    || element.textContent
    || ""
  ).replace(/\s+/g, " ").trim();
  const matches = [...document.querySelectorAll(
    "a,button,[role=link],[role=button]"
  )].filter((element) => (
    visible(element) && label(element) === "Download receipt"
  ));
  if (matches.length !== 1) return {count: matches.length, clicked: false};
  matches[0].click();
  return {count: 1, clicked: true};
})()' --session "$driver_session")" \
  || doordash_hard_stop download download_action_failed
jq -e '.result.count == 1 and .result.clicked == true' \
  <<<"$download_click" >/dev/null \
  || doordash_hard_stop download download_action_ambiguous
unset download_click
```

Poll for at most 30 seconds. A successful click or downloads API response does
not prove a receipt was synchronized. A 22-byte ZIP can be a valid empty ZIP;
it means only that no file is present in that archive. It does not, by itself,
diagnose a DoorDash or Browserbase API defect.

```bash
archive_path="$receipt_workdir/doordash-downloads.zip"
download_ready=false
artifact_provenance=''
supported_entry=''
: >"$archive_path"
chmod 600 "$archive_path"

for attempt in {1..30}; do
  if browse cloud sessions downloads get "$browserbase_session_id" \
      --output "$archive_path" >/dev/null 2>&1; then
    chmod 600 "$archive_path"
    if [[ -s "$archive_path" ]] \
      && unzip -tq "$archive_path" >/dev/null 2>&1; then
      supported_entries="$(unzip -Z1 "$archive_path" 2>/dev/null \
        | rg -i '\.(pdf|png|jpe?g|heic|webp)$' || true)"
      supported_count="$(printf '%s\n' "$supported_entries" \
        | awk 'NF {count += 1} END {print count + 0}')"
      if [[ "$supported_count" == 1 ]]; then
        supported_entry="$supported_entries"
        case "$supported_entry" in
          /*|../*|*/../*|*/..) supported_entry='' ;;
          *) download_ready=true ;;
        esac
      elif (( supported_count > 1 )); then
        doordash_hard_stop download ambiguous_download_artifacts
      fi
      unset supported_entries supported_count
    fi
  fi
  [[ "$download_ready" == true ]] && break
  browse wait timeout 1000 --session "$driver_session" >/dev/null
done
```

If exactly one safe supported entry exists, extract only that entry—not the
whole archive—and validate it before accepting it:

```bash
if [[ "$download_ready" == true ]]; then
  extension="${supported_entry##*.}"
  extension="$(printf '%s' "$extension" | tr '[:upper:]' '[:lower:]')"
  candidate_path="$receipt_workdir/doordash-receipt.$extension"
  : >"$candidate_path"
  chmod 600 "$candidate_path"
  unzip -p "$archive_path" "$supported_entry" >"$candidate_path" \
    || doordash_hard_stop download archive_extract_failed
  chmod 600 "$candidate_path"
  artifact_provenance='single_download_entry'
  unset supported_entry extension
fi
```

An empty, corrupt, unsupported, generic, stale, or content-mismatched archive
is not a receipt. When no valid entry appears by the bound and the complete
receipt remains rendered, continue to the semantic screenshot fallback.

## 6. Capture only the semantic receipt panel

Never use `--full-page`. A full-page capture includes unrelated private account
data and may exceed the Ramp CLI's safe argument size after base64 expansion.

Use the previously validated panel geometry. If the panel is internally
scrollable, expand the viewport, wait for layout to settle, then rerun
`receipt_probe_js`; old coordinates are invalid after a resize:

```bash
if [[ "$download_ready" != true ]]; then
  # The download click or later hydration may have changed layout. Recompute
  # both content booleans and geometry before using any rectangle.
  receipt_probe="$(browse eval "$receipt_probe_js" \
    --session "$driver_session")" \
    || doordash_hard_stop download receipt_probe_failed
  jq -e '
    .result.panelFound == true and
    .result.finalStatus == true and
    .result.dateMatch == true and
    .result.totalMatch == true and
    .result.receiptLabels == true and
    .result.privacyScoped == true and
    .result.hostUS == true and
    .result.orderLocationUS == true and
    .result.totalLabelCount >= 1 and
    .result.targetTotalRowCount == .result.totalLabelCount and
    .result.splitSignals == false and
    .result.nonFinalSignals == false
  ' <<<"$receipt_probe" >/dev/null \
    || doordash_hard_stop download receipt_panel_incomplete

  panel_client_height="$(jq -er '.result.geometry.clientHeight' \
    <<<"$receipt_probe")"
  panel_scroll_height="$(jq -er '.result.geometry.scrollHeight' \
    <<<"$receipt_probe")"

  if (( panel_scroll_height > panel_client_height + 2 )); then
    viewport_width="$(jq -er '.result.geometry.viewportWidth' \
      <<<"$receipt_probe")"
    required_height="$(jq -er '.result.geometry.requiredViewportHeight' \
      <<<"$receipt_probe")"
    (( required_height > 0 && required_height <= 12000 )) \
      || doordash_hard_stop download receipt_panel_geometry_unsafe
    browse viewport "$viewport_width" "$required_height" \
      --session "$driver_session" >/dev/null
    browse wait timeout 500 --session "$driver_session" >/dev/null
    receipt_probe="$(browse eval "$receipt_probe_js" \
      --session "$driver_session")" \
      || doordash_hard_stop download receipt_probe_failed
    jq -e '
      .result.panelFound == true and
      .result.finalStatus == true and
      .result.dateMatch == true and
      .result.totalMatch == true and
      .result.receiptLabels == true and
      .result.privacyScoped == true and
      .result.hostUS == true and
      .result.orderLocationUS == true and
      .result.totalLabelCount >= 1 and
      .result.targetTotalRowCount == .result.totalLabelCount and
      .result.splitSignals == false and
      .result.nonFinalSignals == false and
      .result.geometry.scrollHeight <= (.result.geometry.clientHeight + 2)
    ' <<<"$receipt_probe" >/dev/null \
      || doordash_hard_stop download receipt_panel_incomplete
  fi

  clip="$(jq -er '
    .result.geometry
    | [.x, .y, .width, .height]
    | map(tostring)
    | join(",")
  ' <<<"$receipt_probe")"
  candidate_path="$receipt_workdir/doordash-receipt-panel.png"
  : >"$candidate_path"
  chmod 600 "$candidate_path"
  browse screenshot --animations disabled --clip "$clip" \
    --type png --path "$candidate_path" --session "$driver_session" \
    >/dev/null \
    || doordash_hard_stop download receipt_panel_capture_failed
  chmod 600 "$candidate_path"
  artifact_provenance='semantic_receipt_panel'
  unset panel_client_height panel_scroll_height viewport_width required_height
fi
```

The crop must be the narrowest visible ancestor around **Download receipt**
that contains final status, date, the exact **Total**, and receipt labels. Do not
hard-code an ancestor count, class name, or rectangle.

## 7. Revalidate the artifact itself

Page matching is not artifact validation. Inspect the selected file privately
with an approved PDF/image reader, OCR, or vision tool. Record only these
booleans:

- `artifact_final_status`: **Order complete** or equivalent final state.
- `artifact_date_match`: supplied charged/placed date.
- `artifact_total_match`: the exact `$` final **Total**.
- `artifact_receipt_labels`: evidence such as **Receipt**, **Total**, or
  **Payment** showing this is the authoritative receipt panel.
- `artifact_privacy_scoped`: no neighboring orders or unrelated account data.

First validate the MIME type. Then extract text privately from every supported
download or screenshot; no format may bypass the same content booleans. This
pattern deletes unavoidable intermediate text immediately and never prints or
returns `ocr_path`:

```bash
mime_type="$(file --brief --mime-type -- "$candidate_path")"
case "$mime_type" in
  application/pdf|image/png|image/jpeg|image/heic|image/webp) ;;
  *) doordash_hard_stop download receipt_artifact_unsupported ;;
esac

ocr_path="$receipt_workdir/.receipt-ocr.txt"
: >"$ocr_path"
chmod 600 "$ocr_path"
case "$mime_type" in
  application/pdf)
    command -v pdftotext >/dev/null \
      || doordash_hard_stop download artifact_content_inspector_missing
    pdftotext "$candidate_path" "$ocr_path" 2>/dev/null \
      || doordash_hard_stop download artifact_content_unverified
    ;;
  image/png|image/jpeg|image/heic|image/webp)
    command -v tesseract >/dev/null \
      || doordash_hard_stop download artifact_content_inspector_missing
    tesseract "$candidate_path" stdout 2>/dev/null >"$ocr_path" \
      || doordash_hard_stop download artifact_content_unverified
    ;;
esac

artifact_final_status=false
artifact_date_match=false
artifact_total_match=false
artifact_receipt_labels=false
artifact_privacy_scoped=false
rg -qi 'Order[[:space:]]+complete' "$ocr_path" \
  && artifact_final_status=true
rg -Fq -- "$target_amount_text" "$ocr_path" \
  && artifact_total_match=true
if rg -qi 'Total' "$ocr_path" && rg -qi 'Payment' "$ocr_path"; then
  artifact_receipt_labels=true
fi
case "$artifact_provenance" in
  single_download_entry)
    artifact_privacy_scoped=true
    ;;
  semantic_receipt_panel)
    jq -e '
      .result.panelFound == true and
      .result.privacyScoped == true and
      .result.geometry != null
    ' <<<"$receipt_probe" >/dev/null \
      && artifact_privacy_scoped=true
    ;;
esac

if [[ "$artifact_final_status" != true ]] \
  && jq -e '
    .result.finalStatus == true and
    .result.finalityViaDownload == true and
    .result.nonFinalSignals == false
  ' <<<"$receipt_probe" >/dev/null \
  && ! rg -qi 'order[[:space:]]+(pending|processing|scheduled|cancelled|canceled|refunded)|payment[[:space:]]+(pending|processing)|estimated[[:space:]]+total|authorization[[:space:]]+hold|pre-?authorization' \
    "$ocr_path"; then
  artifact_final_status=true
fi

# Date formatting may vary visually. Generate exact renderings of the supplied
# date; a year alone is not enough.
IFS=- read -r target_year target_month target_day <<<"$transaction_date"
target_month="$((10#$target_month))"
target_day="$((10#$target_day))"
target_month_padded="$(printf '%02d' "$target_month")"
target_day_padded="$(printf '%02d' "$target_day")"
case "$target_month" in
  1) month_short='Jan'; month_long='January' ;;
  2) month_short='Feb'; month_long='February' ;;
  3) month_short='Mar'; month_long='March' ;;
  4) month_short='Apr'; month_long='April' ;;
  5) month_short='May'; month_long='May' ;;
  6) month_short='Jun'; month_long='June' ;;
  7) month_short='Jul'; month_long='July' ;;
  8) month_short='Aug'; month_long='August' ;;
  9) month_short='Sep'; month_long='September' ;;
  10) month_short='Oct'; month_long='October' ;;
  11) month_short='Nov'; month_long='November' ;;
  12) month_short='Dec'; month_long='December' ;;
esac
if rg -Fq -- "$month_short $target_day, $target_year" "$ocr_path" \
  || rg -Fq -- "$month_long $target_day, $target_year" "$ocr_path" \
  || rg -Fq -- "$target_month/$target_day/$target_year" "$ocr_path" \
  || rg -Fq -- "$target_month_padded/$target_day_padded/$target_year" "$ocr_path" \
  || rg -Fq -- "$target_year-$target_month_padded-$target_day_padded" "$ocr_path"; then
  artifact_date_match=true
fi

: >"$ocr_path"
rm "$ocr_path"
unset ocr_path target_year target_month target_day target_month_padded
unset target_day_padded month_short month_long

[[ "$artifact_final_status" == true \
  && "$artifact_date_match" == true \
  && "$artifact_total_match" == true \
  && "$artifact_receipt_labels" == true \
  && "$artifact_privacy_scoped" == true ]] \
  || doordash_hard_stop download artifact_content_unverified
```

If approved vision replaces OCR, it must evaluate the same booleans without
transcribing receipt text. A PDF or image whose contents cannot be inspected is
`artifact_content_unverified`.

The artifact need not render the ISO label `USD`. It must preserve the `$`
total, while the page-level Ramp-USD + US-host + private-US-order-location proof
remains authoritative for currency consistency.

Validate MIME type, the nominal 3 MiB limit, and the current host's safe base64
argument ceiling. Recompute the ceiling at runtime; do not use a size observed
on another machine:

```bash
raw_bytes="$(wc -c <"$candidate_path" | tr -d '[:space:]')"
encoded_bytes=$((((raw_bytes + 2) / 3) * 4))
arg_max="$(getconf ARG_MAX 2>/dev/null || printf '262144')"
environment_bytes="$(env | wc -c | tr -d '[:space:]')"
safe_argument_bytes=$((arg_max - environment_bytes - 65536))

# Linux also limits one argv string below the process-wide ARG_MAX.
if [[ "$(uname -s)" == 'Linux' && $safe_argument_bytes -gt 98304 ]]; then
  safe_argument_bytes=98304
fi

(( raw_bytes > 0 )) \
  || doordash_hard_stop download receipt_artifact_empty
(( raw_bytes <= 3145728 )) \
  || doordash_hard_stop download receipt_artifact_too_large
(( safe_argument_bytes >= 16384 && encoded_bytes <= safe_argument_bytes )) \
  || doordash_hard_stop download receipt_artifact_transport_unsafe
```

If the tight PNG is still too large, do not weaken the content checks or keep
shrinking until the receipt becomes unreadable. Stop with
`receipt_artifact_transport_unsafe`; a later run may use a separately validated
lossy-image path.

After every check passes:

```bash
receipt_path="$candidate_path"
chmod 600 "$receipt_path"
if [[ "$artifact_provenance" == 'single_download_entry' ]]; then
  doordash_artifact_method='download'
elif [[ "$artifact_provenance" == 'semantic_receipt_panel' ]]; then
  doordash_artifact_method='receipt_panel_screenshot'
else
  doordash_hard_stop download artifact_content_unverified
fi

[[ "$archive_path" == "$receipt_path" ]] || rm -f "$archive_path"
unset candidate_path archive_path receipt_probe receipt_probe_js
unset target_date_json target_amount_text_json artifact_provenance
```

The parent now owns `receipt_path`, remote-session release, Ramp dry run/write,
and final retention or deletion.

## Stable and unstable UI

Prefer these live-verified semantic labels:

- **Orders**
- **Personal**
- **Business**
- **View Receipt**
- **Order complete**
- **Download receipt**
- **Group Order**
- **Subtotal**, **Tax**, **Tip**, **Total**, and **Payment**

Do not persist or hard-code:

- snapshot refs such as `@12-34`;
- hashed CSS classes;
- pixel coordinates or ancestor counts;
- order IDs or direct order-detail URLs;
- restaurant, customer, item, address, or payment text.

The current DOM may expose `downloadReceiptButton` or `OrderStatusSection` test
IDs. Treat them only as diagnostic fallbacks after re-verifying their semantic
labels; they are not contracts.

## DoorDash hard stops

| Stage | Code | Meaning |
| --- | --- | --- |
| `context_auth` | `unexpected_origin` | The attached page is not on `doordash.com`. |
| `context_auth` | `handoff_required` | Login, SSO, MFA, one-time code, account chooser, or CAPTCHA needs a human. |
| `context_auth` | `authenticated_orders_unavailable` | The authenticated success signal is absent. |
| `doordash_match` | `invalid_target_date` | The supplied date is not a safe `YYYY-MM-DD` value. |
| `doordash_match` | `invalid_target_amount` | The supplied amount is not integer minor units. |
| `doordash_match` | `currency_unsupported` | The target is not USD; this demo supports USD only. |
| `doordash_match` | `orders_navigation_failed` | Exactly one visible **Orders** action could not be used. |
| `doordash_match` | `account_surface_unavailable` | A visible Personal/Business surface changed during selection. |
| `doordash_match` | `order_probe_failed` | The sanitized in-page order probe could not run. |
| `doordash_match` | `order_surface_not_ready` | The Orders surface did not reach a stable semantic ready state within the bound. |
| `doordash_match` | `order_not_found` | No card matches the target date and exact amount. |
| `doordash_match` | `ambiguous_order_match` | More than one card matches date and exact amount across account surfaces. |
| `doordash_match` | `order_changed_before_click` | The unique match did not remain unique at click time. |
| `doordash_match` | `receipt_probe_failed` | The sanitized final-receipt probe could not run. |
| `doordash_match` | `receipt_not_final_or_mismatched` | Final status, date, exact **Total**, or receipt labels did not validate. |
| `doordash_match` | `split_total_ambiguous` | Participant and organizer/group charges cannot be mapped unambiguously. |
| `doordash_match` | `currency_unverified` | Ramp USD, US host, and private US order-location proof did not all agree. |
| `download` | `private_workdir_missing` | The parent's private artifact directory is unavailable. |
| `download` | `download_action_failed` | The semantic download click could not run. |
| `download` | `download_action_ambiguous` | Exactly one **Download receipt** action is not present. |
| `download` | `ambiguous_download_artifacts` | The archive contains more than one supported candidate. |
| `download` | `archive_extract_failed` | The single safe archive entry could not be extracted. |
| `download` | `receipt_probe_failed` | The semantic panel could not be recalculated after layout changed. |
| `download` | `receipt_panel_geometry_unsafe` | Exposing the whole panel would require an unreasonable viewport. |
| `download` | `receipt_panel_capture_failed` | The semantic clip could not be captured. |
| `download` | `receipt_panel_incomplete` | The complete semantic panel cannot be exposed for one crop. |
| `download` | `artifact_content_inspector_missing` | No approved local PDF/image content inspector is available. |
| `download` | `artifact_content_unverified` | The selected file does not prove final state, date, and exact total. |
| `download` | `receipt_artifact_empty` | The selected file contains zero bytes. |
| `download` | `receipt_artifact_unsupported` | MIME type is not accepted by the Ramp receipt helper. |
| `download` | `receipt_artifact_too_large` | The file exceeds the nominal 3 MiB limit. |
| `download` | `receipt_artifact_transport_unsafe` | A readable artifact cannot fit the runtime argument ceiling. |

Do not retry an unchanged failure outside the bounded download poll. Return the
code and let the parent perform global cleanup and escalation.

## Evidence boundary

Live-verified on the US DoorDash surface:

- homepage to **Orders** navigation;
- Personal/Business surface switching and a globally unique exact-total
  discovery fallback when the list date is not parseable;
- exact date + final-amount card matching and child **View Receipt** on one
  receipt variant;
- both explicit **Order complete** finality and a second variant with one
  **Download receipt**, exact date, duplicate-but-identical exact **Total**
  labels, **Payment**, and no non-final or split signal;
- **Business** and **Group Order** coexisting;
- **Download receipt** returning no synchronized file in a valid empty 22-byte
  ZIP across the bounded polling window; and
- a tight semantic panel screenshot that retained the required receipt evidence
  and fit the runtime transport ceiling.

Conditional and not yet live-verified:

- authentication challenge screens;
- split participant-versus-organizer receipt layouts;
- a successful PDF/image from the downloads archive; and
- non-US or non-USD accounts, which this demo does not support.

Treat conditional branches conservatively. Stop whenever unique matching,
finality, currency consistency, artifact content, or safe transport cannot be
proven.
