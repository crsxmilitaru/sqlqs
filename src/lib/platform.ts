type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as NavigatorWithUAData;
  const platform = (nav.userAgentData?.platform || navigator.platform || navigator.userAgent || "")
    .toLowerCase();

  return platform.includes("mac");
}

export function getModifierKeyLabel(): "Cmd" | "Ctrl" {
  return isMacOS() ? "Cmd" : "Ctrl";
}
