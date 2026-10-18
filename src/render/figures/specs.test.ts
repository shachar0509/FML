import { parseGeometry, parsePlot, sanitizeSvg } from "./specs";

describe("parsePlot", () => {
  it("accepts a valid spec", () => {
    const p = parsePlot(
      '{"xDomain":[-1,1],"data":[{"fn":"x^2"},{"points":[[0,1]],"mode":"scatter"},{"vector":[1,2]}],"annotations":[{"x":1}]}',
    );
    expect(p.data).toHaveLength(3);
  });
  it("rejects bad json and shapes", () => {
    expect(() => parsePlot("nope")).toThrow();
    expect(() => parsePlot('{"data":[]}')).toThrow();
    expect(() => parsePlot('{"xDomain":[0,1],"data":[{"points":[[0,1]],"mode":"x"}]}')).toThrow();
  });
});

describe("parseGeometry", () => {
  const pts = '{"type":"point","id":"A","x":0,"y":0},{"type":"point","id":"B","x":1,"y":1}';
  const mk = (extra: string) => `{"boundingBox":[-1,2,2,-1],"elements":[${pts},${extra}]}`;
  it("accepts valid refs", () => {
    expect(parseGeometry(mk('{"type":"arrow","from":"A","to":[2,1]}')).elements).toHaveLength(3);
  });
  it("rejects unknown ids and bad types", () => {
    expect(() => parseGeometry(mk('{"type":"segment","from":"A","to":"Z"}'))).toThrow(/Z/);
    expect(() => parseGeometry(mk('{"type":"blob"}'))).toThrow();
  });
});

describe("sanitizeSvg", () => {
  it("strips scripts, foreignObject, handlers and external hrefs", () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><foreignObject><div>hi</div></foreignObject><a href="http://evil"><path d="M0 0L1 1" stroke="currentColor"/></a></svg>',
    );
    expect(out).not.toMatch(/script|foreignObject|onload|evil/i);
    expect(out).toContain("<path");
  });
  it("rejects missing viewBox, non-svg and >50KB", () => {
    expect(() => sanitizeSvg("<svg><path d='M0 0'/></svg>")).toThrow();
    expect(() => sanitizeSvg("<div>x</div>")).toThrow();
    expect(() => sanitizeSvg(`<svg viewBox="0 0 1 1"><!--${"a".repeat(51200)}--></svg>`)).toThrow();
  });
});
