type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

function getPlatformString(): string {
  if (typeof navigator === "undefined") return "";

  const nav = navigator as NavigatorWithUAData;
  return (
    nav.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    ""
  ).toLowerCase();
}

export function isMacOS(): boolean {
  const platform = getPlatformString();

  return platform.includes("mac");
}

export function getPlatformClass(): "macos" | "windows" | "other" {
  if (isMacOS()) return "macos";
  const platform = getPlatformString();
  if (platform.includes("win")) return "windows";
  return "other";
}

export function getModifierKeyLabel(): "Cmd" | "Ctrl" {
  return isMacOS() ? "Cmd" : "Ctrl";
}

export function detectPlatform(): string {
  const platform = getPlatformString();
  if (platform.includes("win")) return "Windows";
  if (platform.includes("mac")) return "macOS";
  if (platform.includes("linux")) return "Linux";
  return "Unknown";
}
