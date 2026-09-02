import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ThemeOption } from "../../lib/theme";
import {
  DropdownSetting,
  NumberInputSetting,
  RangeSetting,
  ResetButton,
  SettingContainer,
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

  it("shows reset button on modified toggle and handles reset", () => {
    const onReset = vi.fn();
    const onToggle = vi.fn();
    render(() => (
      <ToggleSetting
        title="Autocomplete"
        description="Show SQL suggestions"
        checked={false}
        defaultValue={true}
        onToggle={onToggle}
        onReset={onReset}
      />
    ));

    const resetButton = screen.getByRole("button", {
      name: "Reset to default (On)",
    });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(onReset).toHaveBeenCalledOnce();
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

  it("shows reset button on modified range and resets to default", () => {
    const onInput = vi.fn();
    render(() => (
      <RangeSetting
        title="Rows"
        description="Maximum rows"
        name="rows"
        value={250}
        min={10}
        max={1000}
        defaultValue={100}
        onInput={onInput}
      />
    ));

    const resetButton = screen.getByRole("button", {
      name: "Reset to default (100)",
    });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(onInput).toHaveBeenCalledWith(100);
  });

  it("renders dropdown setting and handles selection and reset", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(() => (
      <DropdownSetting
        title="Format Style"
        description="SQL indentation style"
        value="compact"
        defaultValue="expanded"
        options={[
          { value: "compact", label: "Compact" },
          { value: "expanded", label: "Expanded" },
        ]}
        onChange={onChange}
        onReset={onReset}
      />
    ));

    expect(screen.getByText("Format Style")).toBeInTheDocument();
    const resetButton = screen.getByRole("button", {
      name: "Reset to default (Expanded)",
    });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("handles number input setting with bounds clamping and reset", () => {
    const onInput = vi.fn();
    const onReset = vi.fn();
    const { container } = render(() => (
      <NumberInputSetting
        title="Query Timeout"
        description="Timeout in seconds"
        name="exec-timeout"
        value={60}
        defaultValue={30}
        min="0"
        max="3600"
        onInput={onInput}
        onReset={onReset}
      />
    ));

    const input = container.querySelector<HTMLInputElement>(
      'input[name="exec-timeout"]',
    )!;
    expect(input).toBeInTheDocument();

    fireEvent.input(input, { target: { value: "5000" } });
    expect(onInput).toHaveBeenCalledWith(3600);

    fireEvent.input(input, { target: { value: "-10" } });
    expect(onInput).toHaveBeenCalledWith(0);

    const resetButton = screen.getByRole("button", {
      name: "Reset to default (30)",
    });
    expect(resetButton).toBeInTheDocument();
    fireEvent.click(resetButton);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("renders standalone reset button", () => {
    const onReset = vi.fn();
    render(() => (
      <ResetButton onReset={onReset} defaultValueLabel="Default Value" />
    ));

    const button = screen.getByRole("button", {
      name: "Reset to default (Default Value)",
    });
    fireEvent.click(button);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("renders setting container with modified indicator", () => {
    const { container } = render(() => (
      <SettingContainer isModified>
        <div>Setting content</div>
      </SettingContainer>
    ));

    expect(
      container.querySelector(".settings-section.is-modified"),
    ).toBeInTheDocument();
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
