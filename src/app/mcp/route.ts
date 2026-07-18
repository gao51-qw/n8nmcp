import { mcpGet, mcpOptions, mcpPost } from "@/lib/mcp-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = mcpOptions;
export const GET = mcpGet;
export const POST = mcpPost;
