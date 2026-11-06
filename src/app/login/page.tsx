import { AuthSuspense, authPageMetadata } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata = authPageMetadata(
  "Sign in",
  "Sign in to the n8n-mcp dashboard to manage API keys, n8n instances, billing and support.",
  "/login",
);

export default function LoginPage() {
  return (
    <AuthSuspense>
      <LoginForm />
    </AuthSuspense>
  );
}
