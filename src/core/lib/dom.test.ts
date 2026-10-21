import { applyLanguage, dirFor } from "./dom";

describe("language switching", () => {
  it("maps language to dir", () => {
    expect(dirFor("he")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });
  it("updates <html> live", () => {
    applyLanguage("en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(document.documentElement).toHaveAttribute("lang", "en");
    applyLanguage("he");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });
});
