#!/usr/bin/env node
// Writes a small two-page text PDF for manual testing and screenshots. No dependencies.
// Usage: node tools/dev/sample-pdf.mjs <out.pdf>
import { writeFileSync } from "node:fs";

const pages = [
  [
    "Intrinsic Dimension of Learned Representations",
    "A. Okonkwo, M. Lindqvist, R. Tanaka",
    "",
    "3 Geometry of the representation",
    "Let h(x) denote the activation of the penultimate layer for an input x,",
    "with d = 4096 throughout. We are interested not in the span of these",
    "vectors but in the shape of the set they occupy. Following Facco et al.,",
    "we estimate the intrinsic dimension from the ratio of each point's",
    "second- and first-nearest-neighbour distances, which uses only the two",
    "closest points to each sample.",
    "",
    "We hypothesise that the representation lies on a low-dimensional",
    "manifold embedded in R^d, and that the intrinsic dimension k << d is",
    "stable across the later layers. Figure 2 supports the second half of",
    "this claim: from layer 18 onward the estimate settles between 22 and",
    "26 while d is unchanged.",
    "",
    "A linear baseline is instructive. PCA retaining 95% of the variance",
    "overestimates k by a factor of three to six on every model we tested",
    "(Table 2), which we take as evidence that the manifold is curved",
    "rather than a subspace. The gap widens with depth.",
  ],
  [
    "4 Fine-tuning",
    "To discourage the network from expanding the surface during",
    "fine-tuning we add a penalty on the local expansion of the map, the",
    "trace of J^T J, where J is the Jacobian of h with respect to its input.",
    "",
    "With lambda = 0.001 the estimated dimension of the fine-tuned model",
    "moves by less than one across all layers, while accuracy is unchanged",
    "to within noise. We return to the choice of lambda in Section 5.",
  ],
];

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function contentFor(lines) {
  const parts = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"];
  lines.forEach((line, i) => {
    const size = i === 0 && /^\d /.test(line) === false && lines === pages[0] ? 16 : /^\d /.test(line) ? 14 : 12;
    parts.push(`/F1 ${size} Tf`);
    parts.push(`(${esc(line)}) Tj T*`);
  });
  parts.push("ET");
  return parts.join("\n");
}

const objects = [];
const add = (body) => { objects.push(body); return objects.length; };

const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
const pageIds = [];
const contentIds = [];
for (const lines of pages) {
  const stream = contentFor(lines);
  contentIds.push(add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`));
}
const pagesId = objects.length + pages.length + 1;
for (let i = 0; i < pages.length; i++) {
  pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`));
}
add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let out = "%PDF-1.4\n%âãÏÓ\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out, "latin1"));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out, "latin1");
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const target = process.argv[2] ?? "sample.pdf";
writeFileSync(target, Buffer.from(out, "latin1"));
console.log(`wrote ${target} (${pages.length} pages)`);
