import { expect, it } from "vitest";
import { historyRefs } from "../app/lib/history-refs";

it.each([
  ["HEAD -> main, origin/HEAD, origin/main", "main, origin/main"],
  ["origin/HEAD", ""],
  ["upstream/HEAD, tag: v1, upstream/main", "tag: v1, upstream/main"],
  ["refs/remotes/origin/HEAD, main", "main"],
  ["HEAD, origin/HEAD", "HEAD"],
  ["feature/HEAD-support, tag: HEAD", "feature/HEAD-support, tag: HEAD"],
  ["", ""],
])("formats history refs %s", (input, expected) => {
  expect(historyRefs(input)).toBe(expected);
});
