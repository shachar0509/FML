import { contrast, ensureContrast } from "./contrast";

it("contrast: black on white is 21, none/transparent is no colour", () => {
  expect(contrast("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21);
  expect(contrast("none", "rgb(255, 255, 255)")).toBeNull();
  expect(contrast("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)")).toBeNull();
});

it("ensureContrast: dark text on a dark figure takes the figure's text colour", () => {
  const el = document.createElement("div");
  el.style.background = "rgb(26, 35, 30)";
  el.style.color = "rgb(236, 238, 230)";
  el.innerHTML = '<svg><text style="fill: rgb(0, 0, 0)">1</text><text style="fill: rgb(140, 200, 242)">ok</text></svg><div style="color: rgb(40, 40, 40)">(1,0)</div>';
  document.body.appendChild(el);
  ensureContrast(el);
  const [bad, ok] = [...el.querySelectorAll("text")];
  expect(bad?.style.fill).toBe("rgb(236, 238, 230)");
  expect(ok?.style.fill).toBe("rgb(140, 200, 242)");
  expect(el.querySelector("div")?.style.color).toBe("rgb(236, 238, 230)");
});
