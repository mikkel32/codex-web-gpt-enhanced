import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

for (const name of ["ci", "release"]) {
  test(`${name} has only an explicit manual trigger; pushes and other workflows cannot launch it`, () => {
    const source = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    const trigger = source.match(/^on:\r?\n([\s\S]*?)(?=^\S)/m)?.[1];
    expect(trigger).toBeDefined();
    const events = [...trigger!.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);
    expect(events).toEqual(["workflow_dispatch"]);
  });
}
