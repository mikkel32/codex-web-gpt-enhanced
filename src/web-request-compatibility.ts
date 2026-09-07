type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);

/** Called only for Web routes, before an adapter or browser turn can be started. */
export function assertWebRequestCompatibility(value: unknown): void {
  if (!object(value)) return;
  if (value.service_tier != null && value.service_tier !== "auto" && value.service_tier !== "default") {
    throw new Error("ChatGPT Web supports only the default service tier. Fast, Priority, and Flex require a native model route.");
  }
  if (value.background != null && value.background !== false) {
    throw new Error("ChatGPT Web does not implement the Responses background-job protocol. Use streaming or a native model route.");
  }
  if (Array.isArray(value.input) && value.input.some(item => object(item) && item.type === "configuration_update")) {
    throw new Error("ChatGPT Web cannot apply native configuration_update items. Select a fixed Web model/effort route, or keep this conversation on a native model.");
  }
  const inspectTools = (tools: unknown): void => {
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (!object(tool)) continue;
      if (tool.async === true) {
        throw new Error("ChatGPT Web does not implement native async tool-call semantics. Use ordinary tool calls or a native model route.");
      }
      if (tool.type === "namespace") inspectTools(tool.tools);
    }
  };
  inspectTools(value.tools);
  if (Array.isArray(value.input)) for (const item of value.input) {
    if (object(item) && item.type === "additional_tools") inspectTools(item.tools);
  }
}
