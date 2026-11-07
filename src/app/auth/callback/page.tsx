import { AuthSuspense, authPageMetadata } from "@/app/login/auth-shell";
import { AuthCallback } from "./auth-callback";

export const metadata = authPageMetadata(
  "Signing you in",
  "Finishing sign-in from an n8n-mcp email link.",
  "/auth/callback",
);

export default function AuthCallbackPage() {
  return (
    <AuthSuspense>
      <AuthCallback />
    </AuthSuspense>
  );
}
