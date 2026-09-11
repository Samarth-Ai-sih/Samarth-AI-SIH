import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="leaflet-map">{children}</div>,
  CircleMarker: ({ children }: { children: React.ReactNode }) => <div data-testid="work-marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => null,
}));

import { WorkExplorerMap } from "./work-explorer-map";
import type { MapWorkMarker } from "@/lib/api";

const marker: MapWorkMarker = {
  work_id: "work-map-001", title: "Recorded health centre", status: "in_progress", category: "healthcare",
  state_code: "UP", state_name: "Uttar Pradesh", district_code: "LKO", district_name: "Lucknow",
  constituency: "Lucknow Central", mp_name: "Example MP", implementing_agency: "Works Agency",
  physical_progress_pct: 55, location: { latitude: 26.8467, longitude: 80.9462, address: "Recorded site" },
  last_updated_at: "2026-09-10T00:00:00Z", sanctioned_amount: 1_000_000, funds_released: null,
  actual_expenditure: null, composite_risk_score: 72, risk_tier: "amber",
  location_notice: "Stored work coordinates; accuracy has not been independently verified.",
};

describe("WorkExplorerMap", () => {
  it("renders only API-supplied marker details and links to the existing Work 360 page", () => {
    render(<WorkExplorerMap markers={[marker]} fitRevision={1} />);

    expect(screen.getByTestId("leaflet-map")).toBeInTheDocument();
    expect(screen.getByTestId("work-marker")).toHaveTextContent("Recorded health centre");
    expect(screen.getByRole("link", { name: "Open Work 360°" })).toHaveAttribute("href", "/dashboard/works/work-map-001");
    expect(screen.getByText(/Markers use stored work coordinates only/i)).toBeInTheDocument();
  });

  it("does not render a map when the API has no valid location markers", () => {
    const { container } = render(<WorkExplorerMap markers={[]} fitRevision={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
