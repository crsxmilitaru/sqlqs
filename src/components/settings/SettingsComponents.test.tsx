import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ThemeOption } from "../../lib/theme";
import {
  RangeSetting,
  ThemeCard,
  ToggleSetting,
} from "./SettingsComponents";

const theme: ThemeOption = {
  id: "ocean",
  name: "Ocean",
  mode: "dark",
  colors: {
    "--color-surface": "#101820",
    "--color-surface-panel": "#182430",
    "--color-text": "#ffffff",
    "--color-accent": "#0088ff",
  },
  tabColors: ["#0088ff"],
};

describe("SettingsComponents", () => {
  it("toggles boolean settings", () => {
    const onToggle = vi.fn();
    render(() => (
      <ToggleSetting
        title="Autocomplete"
        description="Show SQL suggestions"
        checked
        onToggle={onToggle}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Autocomplete" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("emits numeric range values", () => {
    const onInput = vi.fn();
    render(() => (
      <RangeSetting
        title="Rows"
        description="Maximum rows"
        name="rows"
        value={100}
        min={10}
        max={1000}
        defaultValue={100}
        onInput={onInput}
      />
    ));

    fireEvent.input(screen.getByRole("slider"), { target: { value: "250" } });
    expect(onInput).toHaveBeenCalledWith(250);
  });

  it("keeps theme card actions separate from selection", () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(() => (
      <ThemeCard
        theme={theme}
        selected
        custom
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Edit Ocean" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Ocean" }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
