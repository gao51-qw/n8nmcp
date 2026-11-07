// Input schemas shared by the account forms (client-side checks) and the
// /api/auth route handlers (authoritative checks).
import { z } from "zod";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";

// Supabase hashes passwords with bcrypt, which ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

/** Sign-in accepts any stored password (older accounts may predate the length rule). */
export const signInPasswordSchema = z
  .string()
  .min(1, "Enter your password.")
  .max(72, "Use at most 72 characters.");

/** A post-auth destination path; unsafe values collapse to the dashboard. */
export const nextPathSchema = z
  .string()
  .max(2048)
  .nullish()
  .transform((value) => getSafeLoginDestination(value ?? null));

/** A Supabase token as it travels in a JSON body (printable ASCII, bounded). */
export const tokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/);

export const loginBodySchema = z.object({ email: emailSchema, password: signInPasswordSchema });

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  next: nextPathSchema,
});

export const recoverBodySchema = z.object({ email: emailSchema, next: nextPathSchema });

export const exchangeBodySchema = z.object({
  refresh_token: tokenSchema.max(2048),
  access_token: tokenSchema.optional(),
});

export const passwordBodySchema = z.object({ password: passwordSchema });

/** `/reset-password`, carrying a non-default safe destination as `next`. */
export function resetPasswordPath(destination: string): string {
  const safe = getSafeLoginDestination(destination);
  return safe === getSafeLoginDestination(null)
    ? "/reset-password"
    : `/reset-password?next=${encodeURIComponent(safe)}`;
}
