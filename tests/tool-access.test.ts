import { expect, test } from "bun:test";
import { adapterFailureFromMessage, classifyError, httpStatusFromTerminalError } from "../src/lib/errors";
import { nativeAccessSnapshot, nativeCatalogHasExactName } from "../src/adapters/chatgpt-web/access-snapshot";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

const scope = "FORBIDDEN: This conversation is restricted to developer MCPs.";
const safety = "This tool call was blocked by OpenAI because we couldn't determine the safety status of the request.";

test("exact advertised discovery does not need a second tool call, while broader searches still do", () => {
  expect(nativeCatalogHasExactName(" tool_search ", ["exec", "tool_search"])).toBe(true);
  expect(nativeCatalogHasExactName("TOOL_SEARCH", ["tool_search"])).toBe(true);
  expect(nativeCatalogHasExactName("tool", ["tool_search"])).toBe(false);
  expect(nativeCatalogHasExactName(undefined, ["tool_search"])).toBe(false);
  expect(nativeCatalogHasExactName("tool_search", ["exec"])).toBe(false);
});

test("conversation scope and indeterminate safety keep their exact cause and are terminal permission responses", () => {
  for (const [message, code] of [[scope, "conversation_mcp_scope_restricted"], [safety, "tool_safety_status_unknown"],
    ["This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.", "tool_safety_rejected"],
    ["This tool call was blocked by OpenAI’s safety checks.", "tool_safety_rejected"]]) {
    const result = adapterFailureFromMessage(message!);
    expect(result).toEqual({ httpStatus: 403, error: { message, type: "permission_error", code } });
    expect(httpStatusFromTerminalError({ code })).toBe(403);
    expect(classifyError(502, "upstream_error", message!)).toEqual(result.error);
    const withDelay = `${message} Retry after 3 seconds.`;
    expect(adapterFailureFromMessage(withDelay).error.message).toBe(withDelay);
  }
});

test("access classification preserves real authentication, cancellation and ordinary temporary failures", () => {
  expect(classifyError(401, "authentication_error", scope).code).toBe("invalid_api_key");
  expect(classifyError(499, "client_closed_request", scope).code).toBe("client_closed_request");
  expect(adapterFailureFromMessage("FORBIDDEN: access denied").error.code).toBe("permission_denied");
  expect(adapterFailureFromMessage("Upstream temporarily unavailable. Retry after 3 seconds.").httpStatus).toBe(503);
  expect(adapterFailureFromMessage("Upstream temporarily unavailable. Retry after 3 seconds.").error.message).toContain("Please try again in 3s.");
  expect(adapterFailureFromMessage("The tool's safety status will be recorded after execution.").httpStatus).toBe(502);
  expect(adapterFailureFromMessage(safety.replace("couldn't", "couldn\u2019t")).error.code).toBe("tool_safety_status_unknown");
});

function environment(): ChatGptTurnEnvironment {
  return { cwd: "/workspace", roots: ["/workspace", "/shared"], writableRoots: ["/workspace"],
    sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/workspace"], networkAccess: false },
    tools: [
      { name: "read", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } },
      { name: "search", description: "Search", parameters: { type: "object" } },
    ] };
}

test("tool ordering, fresh turn handles and schema key order do not pretend native permissions changed", () => {
  const first = environment();
  const second = { ...environment(), expiresAt: 999, turnToken: "unrelated-handle" };
  second.roots.reverse(); second.tools.reverse();
  second.tools[1]!.parameters = { properties: { path: { type: "string" } }, type: "object" };
  const a = nativeAccessSnapshot(first, "5.20.5", "native");
  const b = nativeAccessSnapshot(second, "5.20.5", "native");
  expect(a).toEqual(b);
  expect(JSON.stringify(b)).not.toContain("unrelated-handle");
  expect(a.listing_grants_permission).toBe(false);
  expect(a.chatgpt_app_authorization).toBe("not_observable_from_native_inventory");
});

test("native policy and advertised catalog changes are independently observable", () => {
  const original = nativeAccessSnapshot(environment(), "5.20.5", "native");
  const changedTools = environment(); changedTools.tools.pop();
  const catalog = nativeAccessSnapshot(changedTools, "5.20.5", "native");
  expect(catalog.native_policy_fingerprint).toBe(original.native_policy_fingerprint);
  expect(catalog.native_tool_catalog_fingerprint).not.toBe(original.native_tool_catalog_fingerprint);
  const changedPolicy = environment(); changedPolicy.sandboxPolicy = { type: "readOnly", networkAccess: false }; changedPolicy.writableRoots = [];
  const policy = nativeAccessSnapshot(changedPolicy, "5.20.5", "native");
  expect(policy.native_policy_fingerprint).not.toBe(original.native_policy_fingerprint);
  expect(policy.native_tool_catalog_fingerprint).toBe(original.native_tool_catalog_fingerprint);
  const network = environment(); network.sandboxPolicy = { type: "workspaceWrite", writableRoots: ["/workspace"], networkAccess: true };
  expect(nativeAccessSnapshot(network, "5.20.5", "native").native_policy_fingerprint).not.toBe(original.native_policy_fingerprint);
});
