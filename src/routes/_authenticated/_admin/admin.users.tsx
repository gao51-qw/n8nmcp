import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Profile = { id: string; email: string | null; display_name: string | null; created_at: string };

export const Route = createFileRoute("/_authenticated/_admin/admin/users")({
  head: () => ({ meta: [{ title: "Admin · Users — n8n-mcp" }] }),
  component: AdminUsers,
});

function AdminUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setUsers(data ?? []));
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-bold">Users</h1>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Name</th>
              <th className="p-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-3">{u.email}</td>
                <td className="p-3">{u.display_name}</td>
                <td className="p-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
