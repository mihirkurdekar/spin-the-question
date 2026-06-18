# Spin the Question

An AI‑powered date‑night game where two people share one phone and answer fun, Gemini‑generated conversation prompts, built as a mobile‑first PWA on AWS Lambda.

See [`SPEC.md`](./SPEC.md) for the full product spec.

## Stack
- **Frontend:** vanilla HTML/CSS/JS in `public/index.html`. No build step. PWA-installable.
- **Backend:** Node 22.x Lambda handler with HMAC session tokens, per-IP rate limiting, and the Google Gemini API.
- **Hosting:** AWS Lambda Function URL. No API Gateway. No database.

## Local development

### 1. Install
```bash
npm install
```

### 2. Run the handler locally (with mock events)
```bash
# From project root. Mock event files in test/events/.
npx lambda-local -l index.js -h handler -e test/events/get-root.json
```

### 3. Run the full app locally
```bash
npm run dev
```

Open `http://127.0.0.1:8000`. By default this sets `FORCE_FALLBACKS=1`, so `/question`
uses the curated fallback pool without needing a Gemini key. To test Gemini locally:
```bash
GEMINI_API_KEY=... HMAC_SECRET=local-dev-secret FORCE_FALLBACKS=0 npm run dev
```

### 4. Run the frontend alone
The frontend expects `window.__SESSION_TOKEN__` to be set in the page. For local dev you can stub it:
```bash
cd public
python3 -m http.server 8000
# In another terminal, create public/index.dev.html with the stubbed token, or:
sed -i '' 's/__SESSION_TOKEN__/dev.fake1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd/' public/index.html
# (Then revert before deploying — see the "Deploy" section.)
```

### 5. End-to-end with a real Gemini key
```bash
export GEMINI_API_KEY=...   # from https://aistudio.google.com/app/apikey
export HMAC_SECRET=$(openssl rand -hex 32)
node -e "require('./question.js').generateQuestion({ category: 'Spicy', questionNumber: 1, totalQuestions: 20, playerNames: ['Test1','Test2'], keepItLight: true }).then(console.log)"
```

To test the fallback pool while Gemini is still configured:
```bash
FORCE_FALLBACKS=1 node -e "require('./question.js').generateQuestion({ category: 'Chaos', questionNumber: 1, totalQuestions: 20, playerNames: ['Test1','Test2'], keepItLight: true }).then(console.log)"
```

## Deploy

This project uses Terraform (see the `terraform/` directory) to manage deployment of the Lambda and Function URL.

A helper script is available at `scripts/deploy-terraform.sh` for common deploy flows.

### Deploy with Terraform

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform/terraform.tfvars with gemini_api_key, hmac_secret, self_origin, allowed_origins, and AWS settings.
./scripts/deploy-terraform.sh
```

The script removes any existing `function.zip`, initializes Terraform, and performs `terraform apply -auto-approve` using `terraform/terraform.tfvars` by default.

## Terraform deploy

The project includes a `terraform/` directory for deploying the Lambda and Function URL.

1. Copy the example vars file:
```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
```
2. Edit `terraform/terraform.tfvars` and set:
   - `gemini_api_key`
   - `hmac_secret`
   - `self_origin`
   - `allowed_origins`

3. Initialize Terraform:
```bash
cd terraform
terraform init
```

4. Preview the planned AWS changes:
```bash
terraform plan
```

5. Apply the deployment:
```bash
terraform apply
```

6. After apply, get the function URL:
```bash
terraform output function_url
```

You can also set secrets with environment variables and a custom tfvars file:
```bash
GEMINI_API_KEY=... HMAC_SECRET=$(openssl rand -hex 32)
cat <<EOF > terraform/terraform.tfvars
aws_region     = "us-east-1"
source_dir     = ".."
role_name      = "spin-the-question-lambda-role"
function_name  = "spin-the-question"
handler        = "index.handler"
runtime        = "nodejs20.x"

gemini_api_key = "$GEMINI_API_KEY"
hmac_secret    = "$HMAC_SECRET"
force_fallbacks = "0"
self_origin    = "https://your-app-origin.example"
allowed_origins = ["https://your-app-origin.example"]
EOF

cd terraform
erraform init
erraform apply
```

## Project layout

```
spin-the-question/
├── index.js           # Lambda handler — routing, token, CORS, OPTIONS, logging
├── question.js        # Gemini API call + robust JSON parser + /vibe logic
├── rateLimit.js       # In-memory per-IP rate limiter
├── fallbacks.js       # Hardcoded fallback questions per category
├── wildcards.js       # Server-side exports (none today; placeholder)
├── public/
│   ├── index.html     # Entire frontend
│   ├── manifest.json  # PWA manifest
│   ├── sw.js          # Service worker
│   ├── wildcards.js   # Client-side wildcard prompts
│   ├── icon-192.png
│   └── icon-512.png
├── scripts/
│   └── make-icons.js  # Generates the two PWA icons
├── test/
│   ├── events/        # Mock Lambda events for local testing
│   └── handler.test.js

├── package.json
├── .env.example
├── .gitignore
├── SPEC.md            # Authoritative product spec
└── README.md
```

## Security notes

- The HMAC session token prevents casual cross-session abuse but does **not** prevent a determined attacker from loading `index.html` once and reusing the embedded token for up to 2h. See `SPEC.md` for the full threat model.
- For production-scale abuse protection, put Cloudflare in front of the Function URL.

## License

MIT.
