#!/usr/bin/env bash
set -euo pipefail
set +x 2>/dev/null || true

usage() {
  printf '%s\n' \
    'Usage: upload-receipt.sh --environment <sandbox|production> --config-home <path> --transaction <uuid> --file <path> [--execute]' \
    '' \
    'Defaults to a Ramp dry run. Pass --execute only after the receipt match is verified and authorized.'
}

environment=''
ramp_config_home=''
transaction_uuid=''
receipt_path=''
execute='false'

while (($#)); do
  case "$1" in
    --environment)
      environment="${2:-}"
      shift 2
      ;;
    --transaction)
      transaction_uuid="${2:-}"
      shift 2
      ;;
    --config-home)
      ramp_config_home="${2:-}"
      shift 2
      ;;
    --file)
      receipt_path="${2:-}"
      shift 2
      ;;
    --execute)
      execute='true'
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$environment" != 'sandbox' && "$environment" != 'production' ]]; then
  printf '%s\n' 'Error: --environment must be sandbox or production.' >&2
  exit 2
fi

if [[ -z "$ramp_config_home" || ! -d "$ramp_config_home" ]]; then
  printf '%s\n' 'Error: --config-home must be the existing isolated Ramp agent config directory.' >&2
  exit 2
fi

if [[ ! "$transaction_uuid" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
  printf '%s\n' 'Error: --transaction must be a UUID.' >&2
  exit 2
fi

if [[ -z "$receipt_path" || ! -f "$receipt_path" || ! -r "$receipt_path" ]]; then
  printf '%s\n' 'Error: --file must be a readable receipt file.' >&2
  exit 2
fi

command -v ramp >/dev/null 2>&1 || {
  printf '%s\n' 'Error: ramp CLI is not installed.' >&2
  exit 127
}

ramp_version_output="$(ramp --version 2>/dev/null || true)"
if [[ ! "$ramp_version_output" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  printf '%s\n' 'Error: could not determine the Ramp CLI version.' >&2
  exit 2
fi
ramp_major="${BASH_REMATCH[1]}"
ramp_minor="${BASH_REMATCH[2]}"
ramp_patch="${BASH_REMATCH[3]}"
if ((ramp_major < 1)) && ((ramp_minor < 2 || (ramp_minor == 2 && ramp_patch < 24))); then
  printf '%s\n' 'Error: Ramp CLI 0.2.24 or newer is required for the validated receipt-upload schema.' >&2
  exit 2
fi

command -v file >/dev/null 2>&1 || {
  printf '%s\n' 'Error: file utility is required for MIME validation.' >&2
  exit 127
}

content_type="$(file --brief --mime-type -- "$receipt_path")"
case "$content_type" in
  application/pdf|image/png|image/jpeg|image/heic|image/webp) ;;
  *)
    printf 'Error: unsupported receipt MIME type: %s\n' "$content_type" >&2
    exit 2
    ;;
esac

decoded_bytes="$(wc -c < "$receipt_path" | tr -d '[:space:]')"
if ((decoded_bytes == 0)); then
  printf '%s\n' 'Error: receipt file is empty.' >&2
  exit 2
fi

if ((decoded_bytes > 3145728)); then
  printf '%s\n' 'Error: receipt exceeds Ramp CLI decoded-size limit of 3 MiB.' >&2
  exit 2
fi

encoded_bytes=$((((decoded_bytes + 2) / 3) * 4))
arg_max="$(getconf ARG_MAX 2>/dev/null || printf '262144')"
environment_bytes="$(env | wc -c | tr -d '[:space:]')"
safe_argument_bytes=$((arg_max - environment_bytes - 65536))

# Linux limits each individual argv entry even when ARG_MAX is larger. Leave
# headroom below the usual 128 KiB MAX_ARG_STRLEN ceiling.
if [[ "$(uname -s)" == 'Linux' && $safe_argument_bytes -gt 98304 ]]; then
  safe_argument_bytes=98304
fi

if ((safe_argument_bytes < 16384 || encoded_bytes > safe_argument_bytes)); then
  printf '%s\n' \
    'Error: base64 payload is too large for a safe Ramp CLI argument on this host.' \
    'Use a smaller receipt artifact or an explicitly authorized Ramp web/mobile/email upload path.' >&2
  exit 2
fi

filename="$(basename -- "$receipt_path")"
file_content_base64="$(base64 < "$receipt_path" | tr -d '\r\n')"

command=(
  ramp
  --env "$environment"
  --no-input
  --agent
  receipts upload
  --content_type "$content_type"
  --filename "$filename"
  --file_content_base64 "$file_content_base64"
  --transaction_uuid "$transaction_uuid"
  --rationale 'Attach the exact matched vendor receipt to the verified Ramp transaction.'
)

sanitize_ramp_output() {
  sed -E \
    -e 's/("(file_content_base64|fileContentBase64)"[[:space:]]*:[[:space:]]*")[^"]*(")/\1<redacted>\3/g' \
    -e 's/(--file_content_base64(=|[[:space:]]+))[^[:space:]]+/\1<redacted>/g'
}

if [[ "$execute" != 'true' ]]; then
  command+=('--dry_run')
  printf '%s\n' 'Mode: dry-run (no receipt will be uploaded).' >&2
else
  printf '%s\n' "Mode: execute against Ramp $environment." >&2
fi

command_status=0
if command_output="$(XDG_CONFIG_HOME="$ramp_config_home" "${command[@]}" 2>&1)"; then
  command_status=0
else
  command_status=$?
fi
printf '%s\n' "$command_output" | sanitize_ramp_output
unset command_output
if ((command_status != 0)); then
  exit "$command_status"
fi
unset file_content_base64
