import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("frontend health endpoint", () => {
  it("returns a safe liveness payload", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "samarth-frontend",
    });
  });
});
