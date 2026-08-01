// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "vitest-dom/extend-expect";
import CopyableSecret from "../CopyableSecret";

describe("CopyableSecret", () => {
    const writeText = vi.fn();

    beforeEach(() => {
        writeText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    test("shows the complete value in a selectable read-only field", () => {
        const token = "gta_prefix_this-is-the-entire-secret-value";
        render(<CopyableSecret value={token} label="API key" />);

        const field = screen.getByRole("textbox", { name: "Full API key" });
        expect(field).toHaveValue(token);
        expect(field).toHaveAttribute("readonly");
        expect(screen.getByRole("button", { name: "Copy API key" })).toBeInTheDocument();
    });

    test("copies the exact value and announces success", async () => {
        const token = "gta_prefix_secret";
        render(<CopyableSecret value={token} label="API key" />);

        fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
        expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("API key copied to clipboard.");
    });

    test("keeps manual selection available when clipboard access fails", async () => {
        writeText.mockRejectedValue(new Error("denied"));
        Object.defineProperty(document, "execCommand", {
            configurable: true,
            value: vi.fn().mockReturnValue(false),
        });
        render(<CopyableSecret value="gta_manual_secret" label="API key" />);

        fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));

        await waitFor(() => {
            expect(screen.getByRole("status")).toHaveTextContent("Select the full value above");
        });
        expect(screen.getByRole("textbox", { name: "Full API key" })).toHaveValue("gta_manual_secret");
    });
});
