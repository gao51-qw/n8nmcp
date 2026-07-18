#!/usr/bin/env bash

validate_email_otp_template() {
  local template_path="$1"

  [[ -f "$template_path" && ! -L "$template_path" ]] || {
    printf 'OTP template must be a regular non-symlink file.\n' >&2
    return 1
  }

  if ! LC_ALL=C awk '
    function reject() {
      invalid = 1
      exit 1
    }

    BEGIN {
      in_action = 0
      action_count = 0
      action = ""
      invalid = 0
    }

    {
      line = $0
      for (i = 1; i <= length(line); i++) {
        pair = substr(line, i, 2)
        character = substr(line, i, 1)

        if (!in_action) {
          if (pair == "{{") {
            in_action = 1
            action = ""
            i++
          } else if (character == "{" || character == "}") {
            reject()
          }
        } else if (pair == "}}") {
          normalized = action
          sub(/^[[:space:]]+/, "", normalized)
          sub(/[[:space:]]+$/, "", normalized)
          if (normalized != ".Token") {
            reject()
          }
          action_count++
          in_action = 0
          action = ""
          i++
        } else if (character == "{" || character == "}") {
          reject()
        } else {
          action = action character
        }
      }

      if (in_action) {
        action = action "\n"
      }
    }

    END {
      if (invalid || in_action || action_count != 1) {
        exit 1
      }
    }
  ' "$template_path"; then
    printf 'OTP template must contain exactly one Token action with balanced delimiters.\n' >&2
    return 1
  fi

  if LC_ALL=C grep -Eiq \
    '(\.ConfirmationURL|href[[:space:]]*=|src(set)?[[:space:]]*=|action[[:space:]]*=|https?:[[:space:]]*//|(^|[^:])//|url[[:space:]]*\(|<[[:space:]]*(a|area|img|link|script|iframe|object|embed)([[:space:]>])|tracking|pixel)' \
    "$template_path"; then
    printf 'OTP template contains a forbidden link, URL, source, action, or tracking construct.\n' >&2
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if (( $# != 1 )); then
    printf 'Usage: %s TEMPLATE_PATH\n' "$0" >&2
    exit 2
  fi
  validate_email_otp_template "$1"
fi
