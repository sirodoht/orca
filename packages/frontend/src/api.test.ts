import { afterEach, expect, spyOn, test } from "bun:test";
import { createMarket, updateMarket } from "./api";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalTimezone = Bun.env.TZ;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => {
  fetchSpy?.mockRestore();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  if (originalTimezone === undefined) delete Bun.env.TZ;
  else Bun.env.TZ = originalTimezone;
});

for (const operation of ["create", "edit"] as const) {
  test(`${operation} sends the selected browser-local time with an explicit UTC offset`, async () => {
    Bun.env.TZ = "Europe/London";
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true, value: { getItem: () => null },
    });
    let sent: any;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input, options) => {
      sent = JSON.parse(String(options?.body));
      return Response.json({ market: {} });
    }) as typeof fetch);
    const payload = { question: "A summer market", closeAt: "2027-07-01T12:00" };
    if (operation === "create") await createMarket(payload);
    else await updateMarket(1, payload);
    expect(sent.closeAt).toBe("2027-07-01T11:00:00.000Z");
    // A server in UTC must see the same instant.
    Bun.env.TZ = "UTC";
    expect(new Date(sent.closeAt).toISOString()).toBe("2027-07-01T11:00:00.000Z");
    expect(payload.closeAt).toBe("2027-07-01T12:00");
  });
}
