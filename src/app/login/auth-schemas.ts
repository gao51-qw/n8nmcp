import { z } from "zod";
import { emailSchema, passwordSchema, signInPasswordSchema } from "@/lib/auth/schemas";

export { emailSchema, passwordSchema, resetPasswordPath } from "@/lib/auth/schemas";

export const signInSchema = z.object({ email: emailSchema, password: signInPasswordSchema });

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
