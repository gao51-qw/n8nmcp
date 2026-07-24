import handler from "vinext/server/app-router-entry";
import { runWithExecutionContext } from "vinext/shims/request-context";
import type { ExecutionContextLike } from "vinext/shims/request-context";

export default {
  fetch(request: Request, env: { ASSETS?: { fetch(request: Request): Promise<Response> | Response } }, ctx: ExecutionContextLike) {
    return runWithExecutionContext(ctx, () => handler.fetch(request, env, ctx));
  },
};
