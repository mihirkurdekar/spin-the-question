#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TERRAFORM_DIR="$ROOT/terraform"
TFVARS="${TFVARS:-terraform.tfvars}"

cd "$TERRAFORM_DIR"
rm -f function.zip

if [[ ! -f "$TFVARS" ]]; then
  echo "Missing Terraform vars file: $TFVARS" >&2
  echo "Create one from terraform.tfvars.example or set TFVARS to a valid file." >&2
  exit 1
fi

terraform init
terraform apply -auto-approve -var-file="$TFVARS"
