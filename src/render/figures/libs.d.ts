declare module "wavedrom" {
  const wd: {
    renderAny(index: string, source: unknown, skin: unknown): unknown;
    onml: { stringify(tree: unknown): string };
  };
  export default wd;
}
declare module "wavedrom/skins/default.js" {
  const skin: unknown;
  export default skin;
}
declare module "wavedrom/skins/dark.js" {
  const skin: unknown;
  export default skin;
}
