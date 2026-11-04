// RFC 9728 OAuth 2.0 Protected Resource Metadata for the MCP endpoint.
// Served at /.well-known/oauth-protected-resource and at the path-suffixed
// form /.well-known/oauth-protected-resource/mcp that MCP clients try first.
import {
  protectedResourceMetadata,
  protectedResourceResponseHeaders,
} from "@/lib/oauth/metadata.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const metadata = protectedResourceMetadata();
  if (!metadata) {
    return new Response("Not Found", { status: 404, headers: protectedResourceResponseHeaders() });
  }
  return Response.json(metadata, { headers: protectedResourceResponseHeaders() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: protectedResourceResponseHeaders() });
}
