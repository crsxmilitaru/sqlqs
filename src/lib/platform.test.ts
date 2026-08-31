import { afterEach, describe, expect, it } from "vitest";
import { getModifierKeyLabel, getPlatformClass, isMacOS } from "./platform";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function setNavigator(platform: string, userAgent = platform) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgentData: { platform },
      platform,
      userAgent,
    },
  });
}

describe("platform", () => {
  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    }
  });

  it("detects macOS and its modifier key", () => {
    setNavigator("macOS");

    expect(isMacOS()).toBe(true);
    expect(getPlatformClass()).toBe("macos");
    expect(getModifierKeyLabel()).toBe("Cmd");
  });

  it("detects Windows and its modifier key", () => {
    setNavigator("Windows");

    expect(isMacOS()).toBe(false);
    expect(getPlatformClass()).toBe("windows");
    expect(getModifierKeyLabel()).toBe("Ctrl");
  });

  it("classifies unknown platforms as other", () => {
    setNavigator("Linux x86_64");

    expect(getPlatformClass()).toBe("other");
    expect(getModifierKeyLabel()).toBe("Ctrl");
  });
});
