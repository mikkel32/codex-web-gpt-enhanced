export type ExternalToolAccessCode = "conversation_mcp_scope_restricted" | "tool_safety_status_unknown" | "tool_safety_rejected";

/** Classify observed service errors only; native sandbox permissions cannot predict these decisions. */
export function externalToolAccessCode(message: string): ExternalToolAccessCode | undefined {
  const text = message.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  if (text.includes("this conversation is restricted to developer mcps")) {
    return "conversation_mcp_scope_restricted";
  }
  if (text.includes("blocked by openai")
    && (text.includes("couldn't determine the safety status") || text.includes("could not determine the safety status"))) {
    return "tool_safety_status_unknown";
  }
  if (text.includes("this tool call was blocked by openai's safety checks")) return "tool_safety_rejected";
  return undefined;
}

export const TURN_ACCESS_GUIDANCE = [
  "Turn tokens are scoped handles, not permission settings. A new token or a different discovered tool list does not by itself establish a permission change.",
  "Use the current turn's advertised tools and native sandbox. Compare access.native_policy_fingerprint separately from access.native_tool_catalog_fingerprint when diagnosing changes; deferred tool discovery can differ without changing the native policy.",
  "Native inventory does not expose or grant ChatGPT app authorization. FORBIDDEN: This conversation is restricted to developer MCPs is an observed conversation tool-scope restriction, not proof that local filesystem access, credentials or the tunnel changed.",
  "A scope or safety rejection is terminal for the denied operation. Preserve successful work and continue independently authorized operations. Do not switch conversations, accounts, computers or gateways, replay the request, or alter permissions to evade the rejection. A catalog refresh is not proof that a rejection has been removed.",
].join("\n");
