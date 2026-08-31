import "@testing-library/jest-dom/vitest";
import { cleanup } from "@solidjs/testing-library";
import { afterEach, vi } from "vitest";
import { resetInvokeMock } from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/window", () => ({
  Effect: { Mica: "mica" },
  EffectState: { Active: "active" },
  getCurrentWindow: vi.fn(() => ({
    destroy: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    maximize: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
    onResized: vi.fn().mockResolvedValue(() => undefined),
    setEffects: vi.fn().mockResolvedValue(undefined),
    setTheme: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn().mockResolvedValue(undefined),
  })),
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, "requestAnimationFrame", {
  configurable: true,
  writable: true,
  value: (callback: (time: number) => void) => {
    callback(performance.now());
    return 1;
  },
});

Object.defineProperty(window, "cancelAnimationFrame", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
});

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollBy", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value: vi.fn(() => []),
});

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: vi.fn(() => new DOMRect()),
});

class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

resetInvokeMock();

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  resetInvokeMock();
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => ({
    measureText: () => ({ width: 8 }),
  })),
});
