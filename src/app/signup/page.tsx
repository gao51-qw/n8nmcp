import { AuthSuspense, authPageMetadata } from "../login/auth-shell";
import { SignupForm } from "./signup-form";

export const metadata = authPageMetadata(
  "Create your account",
  "Create a free n8n-mcp account to connect your n8n workflows to MCP-compatible AI clients.",
  "/signup",
);

export default function SignupPage() {
  return (
    <AuthSuspense>
      <SignupForm />
    </AuthSuspense>
  );
}
