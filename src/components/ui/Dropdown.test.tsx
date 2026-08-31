import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import Dropdown from "./Dropdown";

const options = [
  { value: "app", label: "App" },
  { value: "sales", label: "Sales" },
  { value: "hr", label: "HR" },
];

function renderDropdown(
  overrides: Partial<Parameters<typeof Dropdown>[0]> = {},
) {
  const onChange = vi.fn();
  render(() => (
    <Dropdown
      value="app"
      options={options}
      onChange={onChange}
      placeholder="Pick database"
      {...overrides}
    />
  ));
  return { onChange };
}

describe("Dropdown", () => {
  it("shows the selected label and opens the list", async () => {
    renderDropdown();

    const trigger = screen.getByRole("combobox", { name: "Pick database" });
    expect(trigger.textContent).toContain("App");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBe(3);
  });

  it("selects an option and closes", async () => {
    const { onChange } = renderDropdown();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Sales" }));

    expect(onChange).toHaveBeenCalledWith("sales");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on outside click and escape", async () => {
    renderDropdown();
    const trigger = screen.getByRole("combobox");

    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates with the keyboard and selects with Enter", async () => {
    const { onChange } = renderDropdown();
    const trigger = screen.getByRole("combobox");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("sales");
  });

  it("opens with arrow keys from a closed state and wraps navigation", async () => {
    const { onChange } = renderDropdown();
    const trigger = screen.getByRole("combobox");

    fireEvent.keyDown(trigger, { key: " " });
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("hr");
  });

  it("filters options when filterable", async () => {
    renderDropdown({ filterable: true });

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    const filterInput = await waitFor(() => {
      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
      return input;
    });
    fireEvent.input(filterInput, {
      target: { value: "sa" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("option").length).toBe(1);
    });
    expect(screen.getByRole("option", { name: "Sales" })).toBeInTheDocument();
  });

  it("shows a no-results state when filtering matches nothing", async () => {
    renderDropdown({ filterable: true });

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    const filterInput = await waitFor(() => screen.getByRole("textbox"));
    fireEvent.input(filterInput, {
      target: { value: "zzz" },
    });

    await waitFor(() => {
      expect(screen.getByText("No results")).toBeInTheDocument();
    });
  });

  it("ignores clicks while disabled", () => {
    renderDropdown({ disabled: true });
    const trigger = screen.getByRole("combobox");

    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the placeholder when no value matches", () => {
    renderDropdown({ value: "missing" });

    expect(screen.getByRole("combobox").textContent).toContain(
      "Pick database",
    );
  });

  it("closes on Tab", async () => {
    renderDropdown();
    const trigger = screen.getByRole("combobox");

    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    fireEvent.keyDown(trigger, { key: "Tab" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("flips upward when bottom viewport space is constrained", async () => {
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });

    renderDropdown();
    const trigger = screen.getByRole("combobox");

    trigger.getBoundingClientRect = () => ({
      left: 100,
      right: 300,
      top: 520,
      bottom: 554,
      width: 200,
      height: 34,
      x: 100,
      y: 520,
      toJSON: () => { },
    });

    fireEvent.click(trigger);
    await waitFor(() => {
      const listbox = screen.getByRole("listbox");
      expect(listbox).toBeInTheDocument();
      expect(listbox.style.bottom).toBe("84px");
      expect(listbox.style.top).toBe("auto");
    });
  });

  it("clamps panel width and left position to viewport padding", async () => {
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 500, writable: true, configurable: true });

    renderDropdown();
    const trigger = screen.getByRole("combobox");

    trigger.getBoundingClientRect = () => ({
      left: 450,
      right: 650,
      top: 100,
      bottom: 134,
      width: 200,
      height: 34,
      x: 450,
      y: 100,
      toJSON: () => { },
    });

    fireEvent.click(trigger);
    await waitFor(() => {
      const listbox = screen.getByRole("listbox");
      expect(listbox).toBeInTheDocument();
      expect(listbox.style.left).toBe("292px");
      expect(listbox.style.top).toBe("138px");
    });
  });
});
