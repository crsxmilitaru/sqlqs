type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

function getPlatformString(): string {
  if (typeof navigator === "undefined") return "";

  const nav = navigator as NavigatorWithUAData;
  return (nav.userAgentData?.platform || navigator.platform || navigator.userAgent || "")
    .toLowerCase();
}

export function isMacOS(): boolean {
  const platform = getPlatformString();

  return platform.includes("mac");
}

export function isWindowsOS(): boolean {
  const platform = getPlatformString();

  return platform.includes("win");
}

export function getPlatformClass(): "macos" | "windows" | "other" {
  if (isMacOS()) return "macos";
  if (isWindowsOS()) return "windows";
  return "other";
}

export function getModifierKeyLabel(): "Cmd" | "Ctrl" {
  return isMacOS() ? "Cmd" : "Ctrl";
}
