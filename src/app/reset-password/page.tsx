import { AuthSuspense, authPageMetadata } from "../login/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = authPageMetadata(
  "Choose a new password",
  "Set a new password for your n8n-mcp account.",
  "/reset-password",
);

export default function ResetPasswordPage() {
  return (
    <AuthSuspense>
      <ResetPasswordForm />
    </AuthSuspense>
  );
}
