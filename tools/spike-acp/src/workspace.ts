import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** A tiny collection folder shaped like the real product's (§6.2 of the plan). */
export function createSampleWorkspace(root: string): { root: string; textPath: string; notesDir: string } {
  const sources = join(root, "sources", "intrinsic-dimension");
  const notesDir = join(root, "notes");
  mkdirSync(sources, { recursive: true });
  mkdirSync(notesDir, { recursive: true });

  const agents = `# QRabbit collection

This folder is a reading collection. You are a tutor helping the reader understand the sources here.

- Sources live under \`sources/<id>/\`. \`text.md\` is the extracted text with \`<!-- page N -->\` markers.
- Cite pages as [p.N] using those markers.
- Write maths as LaTeX: $…$ inline, $$…$$ display.
- Do not modify \`sources/\` or \`threads/\`. You may write notes under \`notes/\`.
- Keep answers scoped to the question; the reader will branch if they want more.
`;
  writeFileSync(join(root, "AGENTS.md"), agents);
  writeFileSync(join(root, "CLAUDE.md"), agents);

  const textPath = join(sources, "text.md");
  if (!existsSync(textPath)) {
    writeFileSync(
      textPath,
      `<!-- page 3 -->
# 2 Setup

Let $h(x) \\in \\mathbb{R}^d$ denote the activation of the penultimate layer for an input $x$, with $d = 4096$ throughout.

<!-- page 4 -->
# 3 Geometry of the representation

We estimate the intrinsic dimension from the ratio of each point's second- and first-nearest-neighbour distances (the TwoNN estimator),
$$\\hat{k} = \\left( \\frac{1}{m} \\sum_{i=1}^{m} \\log \\frac{r_2(x_i)}{r_1(x_i)} \\right)^{-1}$$
which uses only the two closest points to each sample. We hypothesise that the representation lies on a low-dimensional manifold embedded in $\\mathbb{R}^d$, and that the intrinsic dimension $k \\ll d$ is stable across the later layers. Figure 2 supports the second half of this claim: from layer 18 onward the estimate settles between 22 and 26 while $d$ is unchanged.

A linear baseline is instructive. PCA retaining 95% of the variance overestimates $k$ by a factor of three to six on every model we tested (Table 2), which we take as evidence that the manifold is curved rather than a subspace.

<!-- page 5 -->
# 4 Fine-tuning

To discourage the network from expanding the surface during fine-tuning we add a penalty on the trace of $J_\\theta(x)^{\\top} J_\\theta(x)$, where $J_\\theta$ is the Jacobian of $h$ with respect to its input.
`,
    );
  }
  writeFileSync(join(sources, "source.json"), JSON.stringify({ title: "Intrinsic Dimension of Learned Representations (sample)", pages: 5 }, null, 2));
  return { root, textPath, notesDir };
}
