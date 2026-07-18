import { z } from "zod";

export const AdminQueueSchema = z.enum([
  "unassigned",
  "mine",
  "waiting_user",
  "sla_due",
  "sla_breached",
  "closed",
]);

export const AdminTicketMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transfer"),
    assignedTo: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("status"),
    status: z.enum(["open", "in_progress", "waiting_user", "resolved", "closed"]),
  }),
  z.object({
    action: z.literal("priority"),
    priority: z.enum(["low", "normal", "high", "urgent"]),
  }),
]);

export const AdminTagSchema = z.object({
  tag: z.string().trim().min(1).max(40),
});

export const AdminNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const AdminNoteUpdateSchema = AdminNoteCreateSchema.extend({
  noteId: z.string().uuid(),
});
