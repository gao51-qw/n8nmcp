import { z } from "zod";

export const CorrelationIdSchema = z.string().trim().min(1).max(128);

export function readSupportCorrelationIds(searchParams: Pick<URLSearchParams, "get">) {
  const sentryEventId = CorrelationIdSchema.safeParse(searchParams.get("sentryEventId"));
  const mcpRequestId = CorrelationIdSchema.safeParse(searchParams.get("mcpRequestId"));
  return {
    sentryEventId: sentryEventId.success ? sentryEventId.data : undefined,
    mcpRequestId: mcpRequestId.success ? mcpRequestId.data : undefined,
  };
}

export const AttachmentSchema = z.object({
  path: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  type: z.string().max(120).optional(),
  expiresAt: z.string().datetime(),
});

export const CreateTicketSchema = z.object({
  ticketId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  category: z.enum(["bug", "feature_request", "billing", "account", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  source: z.enum(["ticket_form", "live_chat"]),
  sentryEventId: CorrelationIdSchema.optional(),
  mcpRequestId: CorrelationIdSchema.optional(),
  attachments: z.array(AttachmentSchema).max(5).default([]),
});

export const TicketListQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "waiting_user", "resolved", "closed"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export const ReplySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  attachments: z.array(AttachmentSchema).max(5).default([]),
});

export const SignAttachmentsSchema = z.object({
  paths: z.array(z.string().min(1).max(512)).min(1).max(5),
});

export const TicketIdSchema = z.string().uuid();

export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;
export type ReplyInput = z.infer<typeof ReplySchema>;
