import { describe, expect, it } from "vitest";
import { calculateSubscriptionExpiry, detectTemplateTokens, isOrderAccessActive, renderTemplate } from "./routers";

describe("script template helpers", () => {
  it("detects unique editable tokens in seller script", () => {
    expect(detectTemplateTokens('<h1>{{storeName}}</h1><img src="{{heroImage}}"><h1>{{storeName}}</h1>')).toEqual(["storeName", "heroImage"]);
  });

  it("renders buyer values into the generated script", () => {
    expect(renderTemplate("{{storeName}} / {{primaryColor}} / {{missing}}", { storeName: "Toko Saya", primaryColor: "#c7f36b" })).toBe("Toko Saya / #c7f36b / ");
  });

  it("sets subscription expiry exactly 30 days later", () => {
    const now = new Date("2026-09-21T00:00:00.000Z");
    expect(calculateSubscriptionExpiry("subscription", 30, now)?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(calculateSubscriptionExpiry("one_time", 30, now)).toBeNull();
  });

  it("locks access after expiry while keeping one-time purchases active", () => {
    const now = new Date("2026-10-21T00:00:00.000Z");
    expect(isOrderAccessActive("paid", new Date("2026-10-20T23:59:59.000Z"), now)).toBe(false);
    expect(isOrderAccessActive("paid", new Date("2026-10-21T00:00:01.000Z"), now)).toBe(true);
    expect(isOrderAccessActive("paid", null, now)).toBe(true);
    expect(isOrderAccessActive("pending", null, now)).toBe(false);
  });
});
