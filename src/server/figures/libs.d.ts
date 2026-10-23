declare module "bytefield-svg" {
  const bytefield: (source: string) => string;
  export default bytefield;
}
declare module "verovio/wasm" {
  const createModule: () => Promise<unknown>;
  export default createModule;
}
declare module "verovio/esm" {
  export const LOG_OFF: number;
  export function enableLog(level: number, module: unknown): void;
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(o: Record<string, unknown>): void;
    loadData(data: string): boolean;
    renderToSVG(page: number): string;
  }
}
