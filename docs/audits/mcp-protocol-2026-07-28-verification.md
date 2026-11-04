# MCP 2026-07-28 dual-version verification

Date: 2026-11-04. Scope: roadmap Phase 1 (`docs/superpowers/plans/2026-11-04-mcp-platform-upgrade-roadmap.md`).

## What the gateway does now

| Area | Legacy clients (2025-06-18) | Modern clients (2026-07-28) |
|---|---|---|
| Era detection | No `_meta` protocol version, and either no `MCP-Protocol-Version` header or a legacy one | `_meta["io.modelcontextprotocol/protocolVersion"]` present |
| Handshake | `initialize` / `notifications/initialized` / `ping` | None. These methods, `logging/setLevel` and `notifications/elicitation/complete` return 404 + `-32601` |
| `server/discover` | 404 + `-32601` | `supportedVersions: ["2026-07-28"]`, capabilities, instructions, `ttlMs`, `cacheScope` |
| Headers | Optional `Mcp-Session-Id` | `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (tools/call) required and compared with the body; Base64 sentinel decoded; mismatch → 400 + `-32020` |
| Version errors | n/a | Unknown version → 400 + `-32022` with `supported` / `requested`; missing `_meta` fields → 400 + `-32602` |
| Batches | Up to 10 per POST | Refused, 400 + `-32600` |
| Results | Unchanged, plus `ttlMs`/`cacheScope` on tools/list | Every result has `resultType` and `_meta["io.modelcontextprotocol/serverInfo"]` |
| `tools/list` | Sorted by name | Sorted by name, `ttlMs: 300000`, `cacheScope: "private"` |
| Confirmation | Issued elicitation id + `notifications/elicitation/complete`, or confirmation token | MRTR: `resultType: "input_required"` with `inputRequests.confirm` (`elicitation/create`, form mode) and a signed `requestState`; retry with `inputResponses`. Clients without form elicitation get the confirmation token |
| No n8n instance | JSON-RPC error `-32002` | Tool result with `isError: true` (2026-07-28 forbids `-32002`) |
| Rate limits | 429 + `-32003` / `-32004` | Same |

`requestState` is HMAC-SHA256 signed with a key derived from `APP_ENCRYPTION_KEY` (HKDF, info `n8n-mcp/mrtr-request-state/v1`). It binds user id, tool name, an order-independent arguments digest, the confirmation fingerprint, a 5-minute expiry and a nonce. Decline and cancel give an empty answer, so confirmation fails closed. A redeemed nonce is refused for the rest of the state's lifetime. That set is per process, so this guarantee is per replica until Phase 6.

## Automated verification

- `src/lib/__tests__/mcp-protocol.server.test.ts`: era classification, header validation (7 mismatch cases), the spec's Base64 encoding table, capability parsing, result envelope, status mapping.
- `src/lib/__tests__/mcp-request-state.server.test.ts`: round trip, argument-order independence, forged body and signature, other user / tool / arguments, expiry, single redemption, malformed input, key rotation.
- `src/lib/__tests__/mcp-route.modern.test.ts`: discover, tools/list, removed methods, header mismatch, unsupported version, batch refusal, notifications (202), throttling (429), missing instance, no elicitation capability, and the full MRTR round trip (accept, decline, cancel, missing answer, answer without state, cross-workflow, cross-user, tampered, replay), plus legacy `initialize` on the same endpoint.
- A mutation check disabled the user binding in `verifyRequestState`. Both the unit and route suites failed, then passed again after restoring it.
- `src/lib/__tests__/mcp-agent-tools.test.ts`: tools/list order is stable across upstream orderings, upstream duplicates collapse and local tools win collisions. A mutation check that dropped the sort failed this test.
- Full suite: 77 files, 730 tests passing. `tsc --noEmit` and `eslint .` are clean.

## Local smoke test (`next dev`)

- `GET /docs/getting-started` renders the client configuration and protocol sections.
- `GET /llms.txt` lists both protocol versions.
- `OPTIONS /mcp` allows `MCP-Protocol-Version, Mcp-Method, Mcp-Name`.
- An unauthenticated modern `server/discover` returns 401. No platform key is available locally, so authenticated calls were covered by the route tests above.

## Still to verify with real clients

These need a deployed build and a platform key, so they have not been run yet:

- [ ] Claude Code (latest): add the endpoint, `tools/list`, then `delete_workflow` on a test workflow and confirm through the prompt.
- [ ] Cursor (latest): the same steps.
- [ ] A 2025-06-18 client against the same deployment, to confirm the legacy path in production.
- [ ] Record which protocol version each client actually sends (gateway logs `protocol_version`, `mcp_name`, `client_name`).
