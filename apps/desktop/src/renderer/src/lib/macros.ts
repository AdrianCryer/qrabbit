import { useStore } from "../state/store";

/**
 * KaTeX macros for everything the app renders. Pages that render maths in the browser declare
 * their macros where the importer can read them (see `macrosInHtml` in the workspace package);
 * pages that render to images keep theirs server side, so a few widely used notations are
 * defined here. A macro a page declares wins over these, and KaTeX's own definitions are
 * untouched for names not listed.
 */
export const DEFAULT_MACROS: Record<string, string> = {
  // Expectation with the distribution written underneath, as OpenAI's Spinning Up defines it
  // in its Sphinx preamble (that preamble never reaches the browser).
  "\\E": "{\\mathrm E}",
  "\\underE": "\\underset{\\begin{subarray}{c}#1 \\end{subarray}}{\\E}\\left[ #2 \\right]",
  "\\Epi": "\\underset{\\begin{subarray}{c}\\tau \\sim \\pi \\end{subarray}}{\\E}\\left[ #1 \\right]",
  "\\expect": "\\underset{\\begin{subarray}{c}#1 \\end{subarray}}{\\E}\\left[ #2 \\right]",
  // Common shorthands that KaTeX does not define (it does define \R, \N, \Z, \argmax, \argmin).
  "\\Var": "\\mathrm{Var}",
  "\\Cov": "\\mathrm{Cov}",
  "\\KL": "\\mathrm{KL}",
  "\\sgn": "\\operatorname{sgn}",
  "\\tr": "\\operatorname{tr}",
  "\\diag": "\\operatorname{diag}",
  "\\rank": "\\operatorname{rank}",
  "\\softmax": "\\operatorname{softmax}",
  "\\norm": "\\left\\lVert #1 \\right\\rVert",
  "\\abs": "\\left\\lvert #1 \\right\\rvert",
  "\\floor": "\\left\\lfloor #1 \\right\\rfloor",
  "\\ceil": "\\left\\lceil #1 \\right\\rceil",
  "\\eps": "\\varepsilon",
  "\\dd": "\\mathrm{d}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\EE": "\\mathbb{E}",
  "\\RR": "\\mathbb{R}",
  "\\NN": "\\mathbb{N}",
  "\\ZZ": "\\mathbb{Z}",
};

let cacheKey: unknown = null;
let cached: Record<string, string> = DEFAULT_MACROS;

/** The defaults plus every macro the open collection's sources declared. Stable across renders. */
export function useMacros(): Record<string, string> {
  const sources = useStore((s) => s.collection?.sources);
  if (sources !== cacheKey) {
    cacheKey = sources;
    const merged = { ...DEFAULT_MACROS };
    for (const src of sources ?? []) if (src.macros) Object.assign(merged, src.macros);
    cached = merged;
  }
  return cached;
}
