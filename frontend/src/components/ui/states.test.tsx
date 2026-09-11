import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./states";

test("shared workspace states present clear accessible next actions", async () => {
  const retry = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<LoadingState label="Loading scoped records…" />);
  expect(screen.getByText("Loading scoped records…")).toBeInTheDocument();

  rerender(<EmptyState title="No assigned work" description="There are no records in this jurisdiction." />);
  expect(screen.getByRole("heading", { name: "No assigned work" })).toBeInTheDocument();

  rerender(<ErrorState description="The service is unavailable." onRetry={retry} />);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});
