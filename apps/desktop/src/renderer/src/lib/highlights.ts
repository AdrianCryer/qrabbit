/** Custom Highlight API registry: paint ranges without touching the DOM. */
export type HL = { add(r: Range): void; delete(r: Range): boolean };

export function highlightFor(name: string): HL | null {
  const g = globalThis as unknown as { CSS?: { highlights?: Map<string, HL> }; Highlight?: new () => HL };
  const reg = g.CSS?.highlights;
  if (!reg || !g.Highlight) return null;
  let hl = reg.get(name);
  if (!hl) {
    hl = new g.Highlight();
    reg.set(name, hl);
  }
  return hl;
}
