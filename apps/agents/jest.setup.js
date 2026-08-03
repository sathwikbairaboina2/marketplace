// Test-harness only: lets AWS SDK v3's default credential provider chain resolve when running
// integration tests against SQS/localstack outside Docker (where no AWS_* env vars are set).
// Real credentials, if already present in the environment, always win.
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'local';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'local';
