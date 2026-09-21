import { describe, expect, it } from "vitest";
import { calculateSubscriptionExpiry, detectTemplateTokens, isOrderAccessActive, normalizeScriptTemplate, prepareScriptTemplate, protectGeneratedScript, renderTemplate, rewriteAssetUrl } from "./routers";

describe("script template helpers", () => {
  it("detects unique editable tokens in seller script", () => {
    expect(detectTemplateTokens('<h1>{{storeName}}</h1><img src="{{heroImage}}"><h1>{{storeName}}</h1>')).toEqual(["storeName", "heroImage"]);
  });

  it("renders buyer values into the generated script", () => {
    expect(renderTemplate("{{storeName}} / {{primaryColor}} / {{missing}}", { storeName: "Toko Saya", primaryColor: "#c7f36b" })).toBe("Toko Saya / #c7f36b / ");
  });

  it("turns labelled raw banner and logo URLs into editable appearance fields", () => {
    const raw = '<img id="banner-utama" src="https://example.com/banner.jpg"><img class="logo" src="https://example.com/logo.png"><img src="https://example.com/icon.png">';
    expect(normalizeScriptTemplate(raw)).toBe('<img id="banner-utama" src="{{bannerUrl}}"><img class="logo" src="{{logoUrl}}"><img src="https://example.com/icon.png">');
  });

  it("rejects incomplete template tokens before publication", () => {
    expect(() => prepareScriptTemplate('<h1>{{storeName</h1>')).toThrow("Token template tidak lengkap.");
    expect(prepareScriptTemplate('<h1>{{storeName}}</h1>')).toBe('<h1>{{storeName}}</h1>');
  });

  it("protects inline JavaScript while preserving HTML and image URLs", () => {
    const output = protectGeneratedScript('<img src="https://example.com/banner.jpg"><script>const secretName = "Toko Saya"; console.log(secretName);</script>');
    expect(output).toContain('<img src="https://example.com/banner.jpg">');
    expect(output).toContain("<script>");
    expect(output).toContain("</script>");
    expect(output).not.toContain('console.log(secretName)');
  });

  it("rewrites only internal storage assets to the configured domain", () => {
    expect(rewriteAssetUrl("/manus-storage/templates/banner.png", "https://cdn.example.com")).toBe("https://cdn.example.com/manus-storage/templates/banner.png");
    expect(rewriteAssetUrl("https://external.example/banner.png", "https://cdn.example.com")).toBe("https://external.example/banner.png");
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
