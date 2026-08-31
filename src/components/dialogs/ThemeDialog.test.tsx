import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ThemeDialog from "./ThemeDialog";

describe("ThemeDialog", () => {
  it("requires a name before saving", () => {
    const onSave = vi.fn();
    render(() => (
      <ThemeDialog
        onClose={vi.fn()}
        onSave={onSave}
        activeThemeTabColors={[]}
      />
    ));

    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);

    expect(screen.getByText("Theme name is required.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a new theme with normalized identity", () => {
    const onSave = vi.fn();
    const { container } = render(() => (
      <ThemeDialog
        onClose={vi.fn()}
        onSave={onSave}
        activeThemeColors={{ "--color-bg": "#101010" }}
        activeThemeTabColors={["#112233"]}
        activeThemeMode="dark"
      />
    ));
    const name = container.querySelector<HTMLInputElement>(
      'input[name="theme-name"]',
    )!;

    fireEvent.input(name, { target: { value: "Ocean Blue" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^custom-ocean-blue-/),
        name: "Ocean Blue",
        mode: "dark",
        tabColors: expect.any(Array),
      }),
    );
  });
});
