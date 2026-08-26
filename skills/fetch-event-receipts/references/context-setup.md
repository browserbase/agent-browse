# Set up the `catering-agent` Browserbase context

Read this only when the named context is missing, stale, or logged out.

## Important distinction

The Browse CLI name `catering-agent` is a local alias for an opaque Browserbase
context UUID. The alias is stored on the machine running the CLI; it is not a
server-side display name.

Current Browse CLI releases support naming directly:

```bash
browse cloud contexts create --name catering-agent
```

If someone already created the context and shared its UUID privately, save the
local alias without creating another context:

```bash
browse cloud contexts add catering-agent <context-uuid>
```

Do not put the UUID in source code, a public issue, a PR, or a recording.

## Option A: seed logins in a Browserbase session

Create one persistent session and attach the Browse driver. Use the same lock as
normal runs so setup cannot overlap a receipt fetch:

```bash
context_lock_dir="${TMPDIR:-/tmp}/fetch-event-receipts-catering-agent.lock"
mkdir "$context_lock_dir" 2>/dev/null || {
  printf '%s\n' 'catering-agent is already in use or needs stale-lock review' >&2
  exit 1
}
setup_workdir="$(mktemp -d "${TMPDIR:-/tmp}/catering-context.XXXXXX")"
setup_output="$(browse cloud sessions create \
  --context-id catering-agent \
  --persist \
  --timeout 900 \
  --no-record-session \
  --no-log-session 2>&1)" || exit 1
printf '%s\n' "$setup_output" | sed -n '/^{/,$p' > "$setup_workdir/session.json"
jq -e '
  (.id | type == "string" and test("^[0-9a-fA-F-]{36}$")) and
  (.connectUrl | type == "string" and test("^wss?://"))
' "$setup_workdir/session.json" >/dev/null || exit 1

setup_session_id="$(jq -r '.id' "$setup_workdir/session.json")"
setup_connect_url="$(jq -r '.connectUrl' "$setup_workdir/session.json")"

browse open https://www.doordash.com \
  --cdp "$setup_connect_url" \
  --session catering-context-setup
```

Use `browse cloud sessions debug "$setup_session_id"` to obtain the live-view
URL and open it only after confirming it begins with `https://`. The user, not
the agent, completes passwords, SSO, CAPTCHA, and multifactor authentication in
that live view.

After DoorDash succeeds, reuse the same driver session and open ezCater and
Instacart sequentially. Verify each site by navigating to its order/receipt page
and confirming authenticated account content is visible. Do not record account
names, addresses, or order details as setup evidence.

When all three logins are verified:

```bash
browse stop --session catering-context-setup
browse cloud sessions update "$setup_session_id" --status REQUEST_RELEASE
```

Poll `browse cloud sessions get "$setup_session_id"` until its parsed `status`
is `COMPLETED`. Only that terminal state proves the remote session released and
context persistence finished. Disable recordings during login setup so a replay
cannot capture credentials or one-time authentication screens. Release the lock
with `rmdir "$context_lock_dir"` only after that confirmation; otherwise keep it
for stale-lock review.

## Option B: seed from local Chrome with `$cookie-sync`

Use `$cookie-sync` when the user is already logged into the three sites in a
debuggable local Chrome. Sync only these domains:

```text
doordash.com,ezcater.com,instacart.com
```

For a new sync, save the returned Browserbase context UUID under the requested
name:

```bash
browse cloud contexts add catering-agent <returned-context-uuid>
```

To refresh an existing context, resolve `catering-agent` privately and pass the
real UUID to cookie-sync's `--context` option. Do not echo the UUID into public
logs or artifacts.

## Operating rule for the shared context

Browserbase generally recommends one context per site/login. This demo
intentionally uses one multi-site context so a single receipt agent can visit
all three portals. Keep sessions sequential, use a consistent proxy geography
if one is introduced, and expect individual vendors to expire their own login
state even though the Browserbase context itself persists.

Skill runs enforce an atomic local lock so only one session can use the shared
context at a time.

Ramp is not stored in this context. Follow
[ramp-identity-setup.md](ramp-identity-setup.md) separately and keep the
standalone Ramp agent's CLI state isolated from personal Ramp authentication.
