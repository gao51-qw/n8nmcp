import { AuthSuspense, authPageMetadata } from "../login/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = authPageMetadata(
  "Reset your password",
  "Request a password reset link for your n8n-mcp account.",
  "/forgot-password",
);

export default function ForgotPasswordPage() {
  return (
    <AuthSuspense>
      <ForgotPasswordForm />
    </AuthSuspense>
  );
}
