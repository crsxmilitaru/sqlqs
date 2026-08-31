import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ReleaseChangelog from "./ReleaseChangelog";

describe("ReleaseChangelog", () => {
  it("shows published release notes and marks the current version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            tag_name: "v0.5.0-preview",
            name: "Preview",
            body: "- Added tab groups\n- Improved completion",
            html_url: "https://example.com/release",
            published_at: null,
            prerelease: true,
            draft: false,
          },
        ]),
      }),
    );

    render(() => <ReleaseChangelog currentVersion="0.5.0-preview" />);

    expect(await screen.findByText("0.5.0-preview")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Added tab groups")).toBeInTheDocument();
  });
});
