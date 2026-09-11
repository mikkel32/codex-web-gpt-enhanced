export type ExternalToolAccessCode = "conversation_mcp_scope_restricted" | "tool_safety_status_unknown" | "tool_safety_rejected";

const { externalToolAccessCode: classifyAccessError } = require("../../launcher/electron/tool-access-error.cjs");

/** Shared with the launcher so delivery and runtime errors keep the same cause. */
export function externalToolAccessCode(message: string): ExternalToolAccessCode | undefined {
  return classifyAccessError(message);
}

export const TURN_ACCESS_GUIDANCE = [
  'Begin broad tool discovery with codex_tool_inventory catalog="advertised" to inspect the supplied catalog without executing an additional tool. Search catalog="all" only when deferred discovery is needed and has not been rejected. An incomplete catalog is not evidence that its missing tools do not exist; retain any discovery error and never reroute a rejected operation.',
  "Turn tokens are scoped handles, not permission settings. A new token or a different discovered tool list does not by itself establish a permission change.",
  "Use the current turn's advertised tools and native sandbox. Compare access.native_policy_fingerprint separately from access.native_tool_catalog_fingerprint when diagnosing changes; deferred tool discovery can differ without changing the native policy.",
  "Native inventory does not expose or grant ChatGPT app authorization. FORBIDDEN: This conversation is restricted to developer MCPs is an observed conversation tool-scope restriction, not proof that local filesystem access, credentials or the tunnel changed.",
  "A scope or safety rejection is terminal for the denied operation. Preserve successful work and continue independently authorized operations. Do not switch conversations, accounts, computers or gateways, replay the request, or alter permissions to evade the rejection. A catalog refresh is not proof that a rejection has been removed.",
].join("\n");
