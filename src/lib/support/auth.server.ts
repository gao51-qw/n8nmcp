import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SupportUser = {
  userId: string;
  email: string | null;
};

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export async function requireSupportUser(request: Request): Promise<SupportUser> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw unauthorized();
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw unauthorized();
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
  };
}

export async function requireSupportAdmin(request: Request): Promise<SupportUser> {
  const user = await requireSupportUser(request);
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Response("Forbidden", { status: 403 });
  }

  return user;
}
