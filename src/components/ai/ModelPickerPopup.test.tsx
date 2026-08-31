import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import ModelPickerPopup, { getModelIcon } from "./ModelPickerPopup";
import type { GeminiModelOption, GeminiThinkingLevel } from "../../lib/ai";

const models: GeminiModelOption[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "gemini-3-flash-lite", label: "Gemini 3 Flash Lite" },
];

function renderPicker(props: {
  selected: string;
  thinkingLevel: string;
  onSelect?: () => void;
  onThinkingLevelChange?: (level: GeminiThinkingLevel) => void;
}) {
  const onSelect = props.onSelect ?? vi.fn();
  const onThinkingLevelChange = props.onThinkingLevelChange ?? vi.fn();
  const onClose = vi.fn();
  const [anchorRef, setAnchorRef] = createSignal<HTMLButtonElement>();
  render(() => (
    <div>
      <button ref={setAnchorRef}>anchor</button>
      <ModelPickerPopup
        anchorRef={anchorRef()}
        models={models}
        selected={props.selected}
        thinkingLevel={props.thinkingLevel as never}
        onSelect={onSelect}
        onThinkingLevelChange={onThinkingLevelChange}
        onClose={onClose}
      />
    </div>
  ));
  return { onSelect, onThinkingLevelChange, onClose };
}

describe("getModelIcon", () => {
  it("maps model families to icons", () => {
    expect(getModelIcon("gemini-3-flash-lite")).toBe("fa-feather");
    expect(getModelIcon("gemini-3-flash")).toBe("fa-bolt");
    expect(getModelIcon("gemini-2.5-pro")).toBe("fa-brain");
    expect(getModelIcon("custom-model")).toBe("fa-wand-magic-sparkles");
  });
});

describe("ModelPickerPopup", () => {
  it("marks the selected model and allows switching", () => {
    const { onSelect, onClose } = renderPicker({
      selected: "gemini-2.5-pro",
      thinkingLevel: "low",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Gemini 3 Flash gemini-3-flash" }),
    );

    expect(onSelect).toHaveBeenCalledWith("gemini-3-flash");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("allows minimal thinking for next-generation flash models", async () => {
    const { onThinkingLevelChange } = renderPicker({
      selected: "gemini-3-flash",
      thinkingLevel: "low",
    });

    fireEvent.click(screen.getByRole("button", { name: "Minimal Lowest latency" }));

    await waitFor(() => {
      expect(onThinkingLevelChange).toHaveBeenCalledWith("minimal");
    });
    expect(
      screen.getByRole("button", { name: "Minimal Lowest latency" }),
    ).not.toBeDisabled();
  });

  it("disables minimal thinking for models without support", () => {
    renderPicker({
      selected: "gemini-2.5-pro",
      thinkingLevel: "minimal",
    });

    const minimal = screen.getByRole("button", { name: "Minimal Lowest latency" });
    expect(minimal).toBeDisabled();
    expect(minimal).toHaveAttribute(
      "title",
      "Minimal thinking is not supported by this model",
    );
    expect(screen.getByRole("button", { name: "Low Simple chat" })).not.toBeDisabled();
  });

  it("maps a persisted minimal level to low for unsupported models", () => {
    renderPicker({
      selected: "gemini-2.5-flash",
      thinkingLevel: "minimal",
    });

    expect(
      screen.getByRole("button", { name: "Low Simple chat" }),
    ).toHaveClass("border-accent");
    expect(
      screen.getByRole("button", { name: "Minimal Lowest latency" }),
    ).toBeDisabled();
  });

  it("changes thinking levels", async () => {
    const { onThinkingLevelChange } = renderPicker({
      selected: "gemini-2.5-pro",
      thinkingLevel: "medium",
    });

    fireEvent.click(screen.getByRole("button", { name: "High Deepest" }));

    await waitFor(() => {
      expect(onThinkingLevelChange).toHaveBeenCalledWith("high");
    });
    expect(
      screen.getByRole("button", { name: /Balanced/ }),
    ).toBeInTheDocument();
  });
});
