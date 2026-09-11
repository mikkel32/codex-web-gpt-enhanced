"use strict";

/** Match observed platform refusals, not mentions of permissions in ordinary output. */
function externalToolAccessCode(message) {
  if (typeof message !== "string") return undefined;
  const text = message.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  if (text.includes("this conversation is restricted to developer mcps")) {
    return "conversation_mcp_scope_restricted";
  }
  if (text.includes("blocked by openai")
    && (text.includes("couldn't determine the safety status") || text.includes("could not determine the safety status"))) {
    return "tool_safety_status_unknown";
  }
  if (text.includes("this tool call was blocked by openai's safety checks")
    || /dette værktøj(?:skald)? blev blokeret af openai'?s sikkerhedstjek/.test(text)) {
    return "tool_safety_rejected";
  }
  return undefined;
}

module.exports = { externalToolAccessCode };
