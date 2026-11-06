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

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(72, "Use at most 72 characters."),
});

export const signUpSchema = z
  .object({ email: emailSchema, password: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

/** The first validation message, for a single inline alert. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

/**
 * Supabase appends `error_description` to the redirect (in the hash for the
 * implicit flow, or the query string) when an email link is expired or used.
 */
export function authErrorFromLocation(location: Pick<Location, "hash" | "search">): string | null {
  for (const raw of [location.hash.replace(/^#/, ""), location.search.replace(/^\?/, "")]) {
    const params = new URLSearchParams(raw);
    const description = params.get("error_description") ?? params.get("error");
    if (description) return description.replace(/\+/g, " ").slice(0, 300);
  }
  return null;
}

/** `/reset-password`, carrying a non-default safe destination as `next`. */
export function resetPasswordPath(destination: string): string {
  const safe = getSafeLoginDestination(destination);
  return safe === getSafeLoginDestination(null)
    ? "/reset-password"
    : `/reset-password?next=${encodeURIComponent(safe)}`;
}
