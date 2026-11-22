// Narrow, type-only declarations for the three jobs.mjs functions the strict
// TypeScript fal webhook calls. Runtime behaviour stays in jobs.mjs; this file
// only names the row fields and callbacks that lane reads so it can be checked
// in strict TS without changing the job engine.

/** The generation row fields the webhook lookup and callbacks depend on. */
export interface WebhookGeneration {
  id: string;
  provider_request_id: string | null;
  status: string;
  deleted_at: number | null;
}

export function loadGenerationByProviderRequest(
  env: unknown,
  requestId: string,
): Promise<WebhookGeneration | null>;

export function completeFromWebhook(
  env: unknown,
  generation: WebhookGeneration,
  payload: unknown,
): Promise<unknown>;

export function failFromWebhook(
  env: unknown,
  generation: WebhookGeneration,
  options?: { detail?: unknown; errorType?: unknown },
): Promise<unknown>;
