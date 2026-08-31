import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import Toaster, { toast } from "./Toaster";

describe("Toaster", () => {
  it("renders toasts with tone styling and dismisses them", async () => {
    render(() => <Toaster />);

    toast.success("Saved successfully");
    toast.error("Something broke");
    toast.info("FYI");
    toast.warning("Careful");

    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("FYI")).toBeInTheDocument();
    expect(screen.getByText("Careful")).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Dismiss notification" })[0],
    );

    await waitFor(() => {
      expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("auto-dismisses toasts after their duration", async () => {
    vi.useFakeTimers();
    render(() => <Toaster />);

    toast.info("Temporary", { duration: 1000 });
    expect(screen.getByText("Temporary")).toBeInTheDocument();

    vi.advanceTimersByTime(1100);

    await waitFor(() => {
      expect(screen.queryByText("Temporary")).not.toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it("keeps zero-duration toasts until dismissed manually", async () => {
    vi.useFakeTimers();
    render(() => <Toaster />);

    toast.success("Persistent", { duration: 0 });
    vi.advanceTimersByTime(60000);

    expect(screen.getByText("Persistent")).toBeInTheDocument();
    toast.dismiss(-1);
    vi.useRealTimers();
  });
});
