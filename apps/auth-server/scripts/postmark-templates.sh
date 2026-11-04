#!/usr/bin/env bash
# Idempotent create/update of Postmark templates used by auth-server.
#
# Usage:
#   POSTMARK_SERVER_TOKEN=xxx bash scripts/postmark-templates.sh
#
# Tries GET; if 404 -> POST /templates; else PUT /templates/{alias}.

set -euo pipefail

: "${POSTMARK_SERVER_TOKEN:?set POSTMARK_SERVER_TOKEN}"

upsert() {
  local alias="$1" json="$2"
  # Postmark returns 200 when found, 422 (ErrorCode 1101) when not found — 404 is not used.
  local get_body
  get_body=$(curl -sS \
    -H "Accept: application/json" \
    -H "X-Postmark-Server-Token: $POSTMARK_SERVER_TOKEN" \
    "https://api.postmarkapp.com/templates/$alias")

  if echo "$get_body" | jq -e '.ErrorCode == 1101' >/dev/null 2>&1; then
    echo "[postmark] creating $alias"
    curl -fsS -X POST "https://api.postmarkapp.com/templates" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -H "X-Postmark-Server-Token: $POSTMARK_SERVER_TOKEN" \
      -d "$json" | jq -r '"[postmark] created id=\(.TemplateId) alias=\(.Alias)"'
  else
    echo "[postmark] updating $alias"
    curl -fsS -X PUT "https://api.postmarkapp.com/templates/$alias" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -H "X-Postmark-Server-Token: $POSTMARK_SERVER_TOKEN" \
      -d "$json" | jq -r '"[postmark] updated id=\(.TemplateId) alias=\(.Alias)"'
  fi
}

VERIFY=$(cat <<'JSON'
{
  "Name": "Vortex Verify Email",
  "Alias": "vortex-verify-email",
  "Subject": "Verify your email for {{product_name}}",
  "TemplateType": "Standard",
  "HtmlBody": "<!doctype html><html><body style=\"margin:0;background:#0b1220;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#e5e7eb;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#0b1220;padding:40px 16px;\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#111827;border:1px solid #243044;border-radius:16px;overflow:hidden;\"><tr><td style=\"padding:32px 32px 8px;\"><div style=\"font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;\">{{product_name}}</div><h1 style=\"margin:12px 0 0;font-size:28px;line-height:1.2;color:#fff;\">Verify your email, {{name}}</h1><p style=\"margin:16px 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;\">Click below to confirm this email address and finish setting up your account.</p></td></tr><tr><td style=\"padding:24px 32px;\"><a href=\"{{url}}\" style=\"display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px;\">Verify email</a></td></tr><tr><td style=\"padding:0 32px 28px;font-size:13px;line-height:1.6;color:#94a3b8;\">If the button does not work, copy and paste this URL:<br><a href=\"{{url}}\" style=\"color:#8b5cf6;\">{{url}}</a></td></tr><tr><td style=\"padding:18px 32px;border-top:1px solid #243044;font-size:12px;color:#64748b;\">{{product_name}} - <a href=\"{{product_url}}\" style=\"color:#94a3b8;\">{{product_url}}</a></td></tr></table></td></tr></table></body></html>",
  "TextBody": "Verify your email for {{product_name}}\n\nHi {{name}},\n\nVerify here: {{url}}\n\n{{product_name}} - {{product_url}}"
}
JSON
)

RESET=$(cat <<'JSON'
{
  "Name": "Vortex Reset Password",
  "Alias": "vortex-reset-password",
  "Subject": "Reset your {{product_name}} password",
  "TemplateType": "Standard",
  "HtmlBody": "<!doctype html><html><body style=\"margin:0;background:#0b1220;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#e5e7eb;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#0b1220;padding:40px 16px;\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#111827;border:1px solid #243044;border-radius:16px;overflow:hidden;\"><tr><td style=\"padding:32px 32px 8px;\"><div style=\"font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;\">{{product_name}}</div><h1 style=\"margin:12px 0 0;font-size:28px;line-height:1.2;color:#fff;\">Reset your password, {{name}}</h1><p style=\"margin:16px 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;\">Use the button below to choose a new password. If you didn't request this, you can ignore this email.</p></td></tr><tr><td style=\"padding:24px 32px;\"><a href=\"{{url}}\" style=\"display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px;\">Reset password</a></td></tr><tr><td style=\"padding:0 32px 28px;font-size:13px;line-height:1.6;color:#94a3b8;\">If the button does not work, copy and paste this URL:<br><a href=\"{{url}}\" style=\"color:#8b5cf6;\">{{url}}</a></td></tr><tr><td style=\"padding:18px 32px;border-top:1px solid #243044;font-size:12px;color:#64748b;\">{{product_name}} - <a href=\"{{product_url}}\" style=\"color:#94a3b8;\">{{product_url}}</a></td></tr></table></td></tr></table></body></html>",
  "TextBody": "Reset your {{product_name}} password\n\nHi {{name}},\n\nReset here: {{url}}\n\nIf you didn't request this, ignore this email.\n\n{{product_name}} - {{product_url}}"
}
JSON
)

OTP=$(cat <<'JSON'
{
  "Name": "Vortex Two-Factor OTP",
  "Alias": "vortex-twofa-otp",
  "Subject": "{{otp}} is your {{product_name}} sign-in code",
  "TemplateType": "Standard",
  "HtmlBody": "<!doctype html><html><body style=\"margin:0;background:#0b1220;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#e5e7eb;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#0b1220;padding:40px 16px;\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#111827;border:1px solid #243044;border-radius:16px;overflow:hidden;\"><tr><td style=\"padding:32px 32px 8px;\"><div style=\"font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;\">{{product_name}}</div><h1 style=\"margin:12px 0 0;font-size:28px;line-height:1.2;color:#fff;\">Your one-time code, {{name}}</h1><p style=\"margin:16px 0 0;font-size:15px;line-height:1.7;color:#cbd5e1;\">Enter this code in the app to complete sign-in.</p></td></tr><tr><td style=\"padding:24px 32px 8px;\"><div style=\"display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:14px 18px;font-size:28px;letter-spacing:.18em;font-weight:800;color:#fff;font-family:ui-monospace,'SF Mono',Menlo,monospace;\">{{otp}}</div></td></tr><tr><td style=\"padding:18px 32px 28px;\"><a href=\"{{product_url}}\" style=\"display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px;\">Open {{product_name}}</a></td></tr><tr><td style=\"padding:0 32px 28px;font-size:13px;line-height:1.6;color:#94a3b8;\">If you didn't try to sign in, you can ignore this email.</td></tr><tr><td style=\"padding:18px 32px;border-top:1px solid #243044;font-size:12px;color:#64748b;\">{{product_name}} - <a href=\"{{product_url}}\" style=\"color:#94a3b8;\">{{product_url}}</a></td></tr></table></td></tr></table></body></html>",
  "TextBody": "Your one-time code for {{product_name}}\n\nHi {{name}},\n\nCode: {{otp}}\n\nIf you didn't try to sign in, ignore this email.\n\n{{product_name}} - {{product_url}}"
}
JSON
)

upsert vortex-verify-email "$VERIFY"
upsert vortex-reset-password "$RESET"
upsert vortex-twofa-otp "$OTP"

echo "[postmark] all 3 templates upserted"
