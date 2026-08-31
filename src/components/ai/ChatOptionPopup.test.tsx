import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import ChatOptionPopup, {
  type ChatOptionItem,
} from "./ChatOptionPopup";

const items: ChatOptionItem[] = [
  {
    id: "pro",
    title: "Gemini Pro",
    subtitle: "gemini-2.5-pro",
    icon: "fa-solid fa-brain",
    selected: true,
    category: "Flagship",
  },
  {
    id: "flash",
    title: "Gemini Flash",
    subtitle: "gemini-2.5-flash",
    icon: "fa-solid fa-bolt",
    category: "Fast",
  },
  {
    id: "legacy",
    title: "Legacy",
    icon: "fa-solid fa-wand-magic-sparkles",
    disabled: true,
    disabledNote: "(deprecated)",
    disabledTitle: "No longer available",
    category: "Fast",
  },
];

function renderPopup(
  overrides: Partial<Parameters<typeof ChatOptionPopup>[0]> = {},
) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const [anchorRef, setAnchorRef] = createSignal<HTMLButtonElement>();
  const rendered = render(() => (
    <div>
      <button ref={setAnchorRef}>anchor</button>
      <ChatOptionPopup
        anchorRef={anchorRef()}
        title="Options"
        items={items}
        onSelect={onSelect}
        onClose={onClose}
        {...overrides}
      />
    </div>
  ));
  return { ...rendered, onClose, onSelect, anchor: () => anchorRef() };
}

describe("ChatOptionPopup", () => {
  it("renders items with categories, subtitles, and selection state", () => {
    renderPopup();

    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByText("Flagship")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument();
    expect(screen.getByText("gemini-2.5-flash")).toBeInTheDocument();
    expect(screen.getByText("(deprecated)")).toBeInTheDocument();
    expect(screen.getByText("Gemini Pro").className).toMatch(
      /\btext-text\b/,
    );
  });

  it("selects enabled items", () => {
    const { onSelect } = renderPopup();

    fireEvent.click(screen.getByRole("button", { name: /Gemini Flash/ }));

    expect(onSelect).toHaveBeenCalledWith("flash");
  });

  it("ignores disabled items", () => {
    const { onSelect } = renderPopup();

    fireEvent.click(screen.getByRole("button", { name: /Legacy/ }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Legacy/ }),
    ).toHaveAttribute("title", "No longer available");
  });

  it("closes when clicking outside the popup and anchor", () => {
    const { onClose } = renderPopup();

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open when clicking the anchor or the popup", () => {
    const { onClose, anchor } = renderPopup();

    fireEvent.mouseDown(anchor()!);
    fireEvent.mouseDown(screen.getByText("gemini-2.5-pro"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a header action when provided", () => {
    const onHeaderAction = vi.fn();
    renderPopup({
      headerActionLabel: "Enable all",
      onHeaderAction,
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable all" }));

    expect(onHeaderAction).toHaveBeenCalledOnce();
  });

  it("hides the header action without a handler", () => {
    renderPopup({ headerActionLabel: "Enable all" });

    expect(
      screen.queryByRole("button", { name: "Enable all" }),
    ).not.toBeInTheDocument();
  });

  it("renders a footer when provided", () => {
    renderPopup({ footer: <div data-testid="popup-footer">Footer</div> });

    expect(screen.getByTestId("popup-footer")).toBeInTheDocument();
  });
});
