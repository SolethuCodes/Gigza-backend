import { registerAs } from '@nestjs/config';

export default registerAs('didit', () => ({
  // Verification endpoints (session creation, decisions, workflows, webhook
  // destinations) live on verification.didit.me. Account/auth endpoints
  // (programmatic registration) are on a separate host, apx.didit.me — not
  // used at runtime, only for the one-time account/workflow/webhook setup.
  verificationBaseUrl: process.env['DIDIT_VERIFICATION_BASE_URL'] ?? 'https://verification.didit.me',
  apiKey: process.env['DIDIT_API_KEY'],
  workflowId: process.env['DIDIT_WORKFLOW_ID'],
  // Generated when the webhook destination was registered (POST
  // /v3/webhook/destinations/) — separate from apiKey, used only to verify
  // inbound webhook signatures (X-Signature-V2).
  webhookSecret: process.env['DIDIT_WEBHOOK_SECRET'],
  // Where Didit's hosted verification page sends the user back to after they
  // finish (or abandon) the flow. Reuses the same custom URL scheme the
  // mobile app already registers for OAuth deep links.
  callbackUrl: process.env['DIDIT_CALLBACK_URL'],
}));
