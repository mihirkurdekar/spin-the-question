variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "source_dir" {
  description = "Path to the source directory containing the Lambda function code"
  type        = string
  default     = ".."
}

variable "role_name" {
  description = "Name of the IAM role used by the Lambda function"
  type        = string
  default     = "spin-the-question-lambda-role"
}

variable "function_name" {
  description = "Name of the Lambda function"
  type        = string
  default     = "spin-the-question"
}

variable "handler" {
  description = "Lambda handler entrypoint"
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs20.x"
}

variable "gemini_api_key" {
  description = "Google Gemini API key for production requests"
  type        = string
}

variable "hmac_secret" {
  description = "HMAC secret for session token signing"
  type        = string
}

variable "force_fallbacks" {
  description = "Whether to force fallback questions instead of Gemini"
  type        = string
  default     = "0"
}

variable "self_origin" {
  description = "Optional origin used for self-origin checks and CORS"
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Allowed CORS origins for the Lambda Function URL"
  type        = list(string)
  default     = ["*"]
}
