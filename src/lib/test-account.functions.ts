import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Creates a fresh, pre-confirmed test account using the admin client.
 * Returns the credentials so the client can prefill the login form.
 * Intended for demo / QA flows only.
 */
export const createTestAccount = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ email: string; password: string }> => {
    const rand = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36);
    const email = `test+demo-${ts}-${rand}@n8n-mcp.dev`;
    const password = `Test!${rand}${ts}`;

    const { error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Response(error.message, { status: 500 });

    return { email, password };
  },
);
