# Set up the standalone Ramp receipt identity

Read this before the first live demo or whenever the isolated agent login has
expired.

## Availability and ownership

Ramp currently describes standalone agents as private preview / limited early
access. If an admin cannot see **Company > Agents**, stop and request enablement
through <https://agents.ramp.com/> or `agents@ramp.com`. Never include a Client
secret or token in that request.

A standalone agent belongs to the business, receives permissions explicitly
assigned by an admin, has an accountable human owner, and is attributed as the
actor in supported Ramp activity. This is different from ordinary `ramp auth
login`, which acts on behalf of the human who completed browser OAuth.

## One-time admin setup

Require a Ramp admin. In **Roles & Permissions**, create:

```text
Role: Receipt Cleanup Agent Role
Permission: Review and edit transactions
```

Ramp includes **View transactions and reimbursements** as the visibility
dependency. Do not add card controls, bill permissions, approval-policy access,
payment access, or unrelated administrative permissions.

In **Company > Agents**, create:

```text
Agent: Catering Receipt Agent
Job: Match final catering/vendor receipts to exact card transactions and attach them.
Role: Receipt Cleanup Agent Role
Boundary: Cannot spend, approve, pay, edit policy, or operate outside confirmed receipt cleanup.
```

Save the Client ID and Client secret in approved secure storage. The Client ID
is not secret; the Client secret must never enter chat, shell history, source
code, a plaintext file, or recorded terminal output.

Official onboarding instructions:
<https://agents.ramp.com/skills/ramp-onboard-standalone-agent>

## CLI capability check

The standalone flow requires Ramp CLI 0.2.24 or newer; that is the release whose
auth and receipt schemas this skill validated:

```bash
ramp --version
ramp auth login --help
ramp agent list --help
```

The login help must expose `--client-id`; the agent resource may be conditional
on preview enablement. If the CLI is stale, explain that updating changes the
local installation and ask before running `ramp update`. Do not broaden Ramp
permissions to work around a missing command.

Help text is not the final compatibility proof. Before a live upload, the skill's
receipt helper must complete its no-write `--dry_run` and show the expected
`/developer/v1/agent-tools/upload-receipt-file` endpoint, intended transaction
UUID, MIME type, and redacted base64 field.

Before login, compare the non-secret expected Client ID from provisioning with
the one active `Catering Receipt Agent` and confirm it has `Receipt Cleanup Agent
Role`. Use an admin business-authenticated CLI or UI only for this read-only
identity check. Directory naming is not identity proof. Do not use that human
session for the receipt run.

## Isolated runtime login

Every command for the standalone identity uses its own config directory:

```bash
ramp_agent_config_home="$HOME/.config/ramp-agents/catering-receipt-agent"
```

Open a private local terminal prompt where the user can enter the Client secret
without echo. The authentication call is:

```bash
RAMP_CLIENT_SECRET="$secret" \
XDG_CONFIG_HOME="$ramp_agent_config_home" \
ramp --env production auth login \
  --client-id "$RAMP_CLIENT_ID" \
  --scope transactions:read \
  --scope receipts:write
```

Do not ask the user to paste the secret into chat or a visible command. Hold it
only for the login process, then unset it. Verify the isolated identity without
touching the operator's personal CLI state:

```bash
XDG_CONFIG_HOME="$ramp_agent_config_home" \
ramp --env production auth status
```

Then run one small read-only transaction query under the same prefix. A
successful auth status alone proves neither the expected identity nor permission
correctness. The runtime login must have used the exact Client ID verified above;
if the principal cannot be tied back to it, stop before reads or writes.

Standalone-agent access tokens do not refresh automatically. When an unattended
or long-running runtime receives an auth-expiry error, repeat the client-
credential login through the secure secret mechanism; do not fall back to the
operator's personal Ramp session.
