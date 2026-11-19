import { describe, expect, it } from "vitest";
import { classifyLine, renderLog } from "./logRender";

describe("renderLog", () => {
  it("escapes HTML so log content cannot inject markup", () => {
    const html = renderLog('<img src=x onerror="alert(1)"> & <script>bad()</script>');

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;");
  });

  it("renders one element per line and keeps blank lines", () => {
    expect(renderLog("a\n\nb").match(/<div class="l/g)).toHaveLength(3);
  });
});

describe("classifyLine", () => {
  it.each([
    ["Error: Operation failed", "err"],
    ["Unexpected exit code when planning changes: 1", "err"],
    ["Warning: Deprecated argument", "warn"],
    ["  + resource_attr = 1", "add"],
    ["  - old_attr = 1", "del"],
    ["  ~ changed_attr = 1", "chg"],
    ["-/+ aws_ecs_task_definition.task (replace)", "chg"],
    ["Plan: 4 to add, 1 to change, 1 to destroy.", "head"],
    ["Changes are GO", "ok"],
    ["Planning changes with 0 custom hooks...", ""],
  ])("classifies %j as %j", (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
  });
});
