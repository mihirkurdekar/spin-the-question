// Terraform configuration to deploy Spin the Question to AWS Lambda (Function URL)
// ---------------------------------------------------------------
// This replaces the custom deploy.sh script with declarative resources.
// Place a "terraform.tfvars" (or any *.tfvars) file alongside this
// directory to supply the variable values (including secrets).

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

// ---------------------------------------------------------------
// Pack the Lambda source code into a ZIP file.
// ---------------------------------------------------------------
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/function.zip"
  
  excludes = [
    "test",
    "scripts",
    "terraform",
    ".git",
    ".gitignore",
    ".env",
    ".env.local",
    "README.md",
    "SPEC.md",
    "deploy.sh",
    "*.log",
    "npm-debug.log",
    ".DS_Store"
  ]
}

// ---------------------------------------------------------------
// IAM role used by the Lambda function.
// ---------------------------------------------------------------
resource "aws_iam_role" "lambda_exec" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

// ---------------------------------------------------------------
// Lambda function definition.
// ---------------------------------------------------------------
resource "aws_lambda_function" "spin_the_question" {
  function_name = var.function_name
  handler       = var.handler
  runtime       = var.runtime
  role          = aws_iam_role.lambda_exec.arn
  filename       = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout        = 30
  memory_size    = 256

  // Environment variables – keep secrets out of the code base.
  environment {
    variables = {
      GEMINI_API_KEY   = var.gemini_api_key
      HMAC_SECRET      = var.hmac_secret
      FORCE_FALLBACKS  = var.force_fallbacks
      SELF_ORIGIN      = var.self_origin
    }
  }

  // Ensure the ZIP is recreated when source files change.
  lifecycle {
    create_before_destroy = true
  }
}

// ---------------------------------------------------------------
// Function URL (public HTTP endpoint).  CORS is restricted to the
// origin supplied via var.self_origin – leave empty for a wildcard.
// ---------------------------------------------------------------
resource "aws_lambda_function_url" "public_url" {
  function_name = aws_lambda_function.spin_the_question.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_headers    = ["Content-Type", "X-Session-Token"]
    allow_methods    = ["GET", "POST"]
    allow_origins    = var.allowed_origins
  }
}

output "function_url" {
  description = "The public URL for the Lambda Function"
  value       = aws_lambda_function_url.public_url.function_url
}
