import { figureGuide } from "@/core/claude/prompts/figureGuides";
import { parseGeometry, parsePlot, parseScene, sanitizeSvg } from "./specs";

it("parseScene: the guide example parses; a label needs text; colours are theme names or hex", () => {
  const s = parseScene(figureGuide("scene", []).split("\n").at(-1) ?? "");
  expect(s.objects.map((o) => o.beat ?? 0)).toEqual([0, 1, 2]);
  expect(s.views?.[1]).toMatchObject({ beat: 2 });
  expect(() => parseScene('{"objects":[{"shape":"label","at":[0,0,0]}]}')).toThrow(/a label needs/);
  expect(() => parseScene('{"objects":[{"shape":"box","color":"red"}]}')).toThrow();
  expect(parseScene('{"objects":[{"shape":"line","points":[[0,0,0],[1,1,1]],"color":"#c08020"}]}').objects[0]?.color).toBe("#c08020");
});

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
  it("M81: only a server drawing keeps a PNG/JPEG data URI, and only on <image>", () => {
    const src = '<svg viewBox="0 0 1 1"><image href="data:image/jpeg;base64,AAAA" width="1" height="1"/><image href="data:image/svg+xml;base64,AAAA"/><a href="data:image/png;base64,AAAA"><path d="M0 0"/></a></svg>';
    expect(sanitizeSvg(src)).not.toContain("data:");
    const server = sanitizeSvg(src, 4e6);
    expect(server.match(/data:/g)).toHaveLength(1);
    expect(server).toContain("data:image/jpeg;base64,AAAA");
  });
});

describe("beats (M78)", () => {
  it("geometry and plot parts take a beat and a colour", () => {
    const g = parseGeometry('{"boundingBox":[-1,2,2,-1],"elements":[{"type":"point","id":"A","x":0,"y":0,"beat":1,"color":"blue"},{"type":"curve","fn":"x^2","domain":[-1,1],"beat":2}]}');
    expect(g.elements.map((e) => e.beat)).toEqual([1, 2]);
    expect(parsePlot('{"xDomain":[0,1],"data":[{"fn":"x","beat":2}],"annotations":[{"y":1,"beat":1}]}').data[0]).toMatchObject({ beat: 2 });
    expect(() => parseGeometry('{"boundingBox":[-1,2,2,-1],"elements":[{"type":"point","id":"A","x":0,"y":0,"color":"red"}]}')).toThrow();
  });
  it("a part can't appear before the points it uses", () => {
    expect(() => parseGeometry('{"boundingBox":[-1,2,2,-1],"elements":[{"type":"point","id":"A","x":0,"y":0,"beat":3},{"type":"point","id":"B","x":1,"y":1},{"type":"segment","from":"A","to":"B","beat":2}]}')).toThrow(/point A, which appears only at beat 3/);
  });
  it("svg keeps data-beat, data-focus, class and style, and drops SMIL", () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><g data-beat="2" data-focus="2" class="m-blue drift" style="--dx:5;--dy:0"><circle r="1" fill="currentColor"/></g><animate attributeName="x" to="5"/><set attributeName="x" to="5"/></svg>',
    );
    expect(out).toContain('data-beat="2"');
    expect(out).toContain('data-focus="2"');
    expect(out).toContain('class="m-blue drift"');
    expect(out).toContain("--dx:5");
    expect(out).not.toMatch(/<animate|<set/);
  });
});
