import { expect, test } from "bun:test";
import { nativeContextPrompt } from "../src/adapters/chatgpt-web/native-context";

test("native context distinguishes full local access from an indeterminate host safety check", () => {
  const prompt = nativeContextPrompt({
    text: "Continue the current task",
    images: [],
    multipart: { parts: [JSON.stringify({ version: 2, records: [] }), JSON.stringify({ version: 2, records: [] })], commit: "Continue the current task" },
  });
  expect(prompt.text).toContain("A dangerFullAccess sandbox describes local access");
  expect(prompt.text).toContain("does not disable ChatGPT app permissions or tool safety checks");
  expect(prompt.text).toContain("preserve previously verified actions");
  expect(prompt.text).toContain("not proof of an authentication, filesystem or tunnel fault");
  expect(prompt.text).toContain("Do not retry or reroute the blocked operation to evade the check");
});
