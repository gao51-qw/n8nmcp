// Shared PostgREST error helpers for the MCP gateway modules.

export type RpcError = { code?: string; message: string };

/** PostgREST: the function is not in the schema cache (migration not applied yet). */
export function isMissingFunction(error: RpcError | null): boolean {
  return error?.code === "PGRST202";
}
