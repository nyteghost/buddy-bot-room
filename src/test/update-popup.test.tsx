import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UpdatePopup } from "@/components/update-popup";

// The update check is desktop-only: in the browser it renders nothing at all.
describe("UpdatePopup", () => {
  it("shows nothing outside the desktop app", () => {
    const { container } = render(<UpdatePopup />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/check for updates/i)).not.toBeInTheDocument();
  });
});
