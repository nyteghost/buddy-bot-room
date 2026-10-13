import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage, type UIMessage } from "ai";
import { logStreamError } from "./stream-errors.server";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server.ts";

export function createResponsesCall(
  request: Request,
  config: { baseURL: string; apiKey: string; model: string },
  messages: ModelMessage[],
  instructions?: string,
) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: `${config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    apiKey: config.apiKey,
    headers: { "Lovable-API-Key": config.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
  const reasoning = config.model !== "openai/chat-latest";
  const result = streamText({
    model: provider.responses(config.model),
    // AI SDK 6 lacks `instructions`: rename this key to `system` there.
    ...(instructions ? { system: instructions } : {}),
    messages,
    abortSignal: request.signal,
    maxRetries: 0,
    // Override the SDK's default console.error: a canceled fetch is not a crash.
    onError: logStreamError,
    providerOptions: {
      openai: {
        store: false,
        ...(reasoning
          ? {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            }
          : {}),
      },
    },
  });
  return {
    result,
    responseForMessages: (messages: UIMessage[], metadata: { agentId: string; round: number }) =>
      withLovableAiGatewayRunIdHeader(
        result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: true,
          messageMetadata: ({ part }) => (part.type === "start" ? metadata : undefined),
          onFinish: () => {},
          onError: (error) => {
            if (
              error &&
              typeof error === "object" &&
              "responseBody" in error &&
              typeof error.responseBody === "string"
            ) {
              try {
                const body = JSON.parse(error.responseBody);
                return body.message ?? body.error?.message ?? "AI request failed.";
              } catch {
                /* fallback */
              }
            }
            return error instanceof Error ? error.message : "AI request failed.";
          },
        }),
        runIdFetch,
      ),
    response: () =>
      withLovableAiGatewayRunIdHeader(
        result.toUIMessageStreamResponse({ sendReasoning: true }),
        runIdFetch,
      ),
  };
}
