import { describe, expect, it } from "vitest";
import {
  TAB_GROUP_COLORS,
  defaultGroupName,
  groupColorStyle,
  nextGroupColor,
} from "./tab-groups";

describe("tab groups", () => {
  it("maps group colors to theme variables", () => {
    expect(groupColorStyle("purple")).toEqual({
      "--group-color": "var(--color-tab-group-purple)",
    });
  });

  it("chooses the first unused color", () => {
    expect(nextGroupColor(["blue", "cyan", "green"])).toBe("yellow");
  });

  it("cycles colors after every color has been used", () => {
    expect(nextGroupColor([...TAB_GROUP_COLORS])).toBe("blue");
    expect(defaultGroupName(3)).toBe("Group 3");
  });
});
