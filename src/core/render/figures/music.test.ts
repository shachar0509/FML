import { expect, it } from "vitest";
import { abcBeats } from "./Abc";
import { parseChords } from "./Chords";
import { parseSmiles } from "./Smiles";

it("abc beats: a marked music line gets its beat; headers and comments are not music lines; source lines map to beats for Play", () => {
  const m = abcBeats("X:1\nK:C\n% a comment\nCDEF | % @1\nGABc | % @2-3\n[CEG]4 |");
  expect(m.music).toEqual([["1", undefined], ["2", "3"], null]);
  expect(m.byLine).toEqual([0, 0, 0, 1, 2, 0]);
  expect(m.starts).toEqual([0, 4, 8, 20, 32, 46]);
});

it("chords: fingers, muted strings and beats parse; a bad chart throws", () => {
  expect(parseChords('{"chords":[{"title":"Am","fingers":[[2,1,"1"],[6,"x"]],"beat":2}]}').chords[0]).toMatchObject({ title: "Am", beat: 2, barres: [] });
  expect(() => parseChords('{"chords":[]}')).toThrow();
  expect(() => parseChords('{"chords":[{"fingers":[[2,"y"]]}]}')).toThrow();
});

it("smiles: a plain string is one molecule; JSON lists molecules with beats", () => {
  expect(parseSmiles(" c1ccccc1O ").molecules).toEqual([{ smiles: "c1ccccc1O" }]);
  expect(parseSmiles('{"molecules":[{"smiles":"CCO","label":"אתנול","beat":2}]}').molecules[0]).toMatchObject({ label: "אתנול", beat: 2 });
  expect(() => parseSmiles('{"molecules":[]}')).toThrow();
});
