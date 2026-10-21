// Spec 11.3 {{FIGURE_FORMATS}} (verbatim).
export const FIGURE_FORMATS = `Figure formats (use one fenced block, only when a drawing helps):
- \`\`\`mermaid  Mermaid source: flowchart, stateDiagram-v2 (automata), sequenceDiagram, classDiagram. Use for trees, graphs, automata, flowcharts.
- \`\`\`plot  JSON: {"xDomain":[a,b],"yDomain":[c,d],"data":[{"fn":"x^2","label":"f"},{"points":[[0,1],[1,2]],"mode":"scatter"},{"vector":[1,2],"offset":[0,0]}],"annotations":[{"x":1,"text":"x=1"}]}. fn syntax: x^2, sin(x), sqrt(x), exp(x), log(x), abs(x).
- \`\`\`geometry  JSON: {"boundingBox":[xmin,ymax,xmax,ymin],"axis":true,"elements":[{"type":"point","id":"A","x":0,"y":0,"label":"A"},{"type":"segment","from":"A","to":"B"},{"type":"arrow","from":"A","to":[2,1],"label":"F"},{"type":"circle","center":"A","radius":1},{"type":"polygon","vertices":["A","B","C"]},{"type":"angle","points":["B","A","C"],"label":"α"},{"type":"curve","fn":"x^2","domain":[-1,1]},{"type":"text","x":1,"y":1,"text":"label"}]}. Use for geometry, vectors, forces, the complex plane.
- \`\`\`wavedrom  WaveDrom JSON for digital timing diagrams.
- \`\`\`svg  One <svg viewBox="..."> element, strokes and text in currentColor, no scripts. Use for electrical circuits with standard schematic symbols, and for anything the other formats cannot draw.`;
