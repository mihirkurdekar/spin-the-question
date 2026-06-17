#!/usr/bin/env bash
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-spin-the-question}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ROLE_ARN="${LAMBDA_ROLE_ARN:-}"

if [[ ! -f package.json ]]; then
  echo "Run from the project root." >&2
  exit 1
fi

if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi
npm run make-icons

rm -f function.zip
zip -qr function.zip index.js question.js rateLimit.js fallbacks.js wildcards.js public package.json node_modules

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION_NAME" --zip-file fileb://function.zip --region "$REGION" >/dev/null
else
  if [[ -z "$ROLE_ARN" ]]; then
    echo "Set LAMBDA_ROLE_ARN for first deploy." >&2
    exit 1
  fi
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --memory-size 256 \
    --timeout 10 \
    --zip-file fileb://function.zip \
    --region "$REGION" >/dev/null
fi

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  HMAC_SECRET="${HMAC_SECRET:-$(openssl rand -hex 32)}"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={GEMINI_API_KEY=$GEMINI_API_KEY,HMAC_SECRET=$HMAC_SECRET}" \
    --region "$REGION" >/dev/null
fi

URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query FunctionUrl --output text 2>/dev/null || true)"
if [[ -z "$URL" || "$URL" == "None" ]]; then
  URL="$(aws lambda create-function-url-config --function-name "$FUNCTION_NAME" --auth-type NONE --region "$REGION" --query FunctionUrl --output text)"
fi

ORIGIN="${URL%/}"
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment "Variables={GEMINI_API_KEY=${GEMINI_API_KEY:-},HMAC_SECRET=${HMAC_SECRET:-},SELF_ORIGIN=$ORIGIN}" \
  --region "$REGION" >/dev/null

echo "$URL"
