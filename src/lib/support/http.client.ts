import { supabase } from "@/integrations/supabase/client";

export async function supportFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error || !token) {
    throw new Error("Authentication required");
  }

  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Support request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}
