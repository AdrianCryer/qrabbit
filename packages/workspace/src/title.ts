import type { SourceKind } from "@qrabbit/shared";

/** Names that stay capitalised in sentence case. Words with capitals inside them (PCA, TwoNN, ReLU) keep theirs anyway. */
const KEEP = [
  "Bayes", "Bayesian", "Gauss", "Gaussian", "Markov", "Markovian", "Monte", "Carlo", "Euclidean", "Riemannian", "Hilbert",
  "Fourier", "Laplace", "Laplacian", "Hamiltonian", "Lagrangian", "Newton", "Newtonian", "Jacobian", "Hessian", "Lipschitz",
  "Bernoulli", "Poisson", "Boltzmann", "Shannon", "Wasserstein", "Lebesgue", "Banach", "Bellman", "Nash", "Turing", "Kalman",
  "Pareto", "Hadamard", "Taylor", "Cauchy", "Dirichlet", "Gibbs", "Hopfield", "Boolean", "Cartesian", "Hebbian", "Kolmogorov",
  "Sobolev", "Schrödinger", "Einstein", "Lorentz", "Minkowski", "Lyapunov", "Hermitian", "Kullback", "Leibler", "Mahalanobis",
  "Fisher", "Wiener", "Cholesky", "Krylov", "Lanczos", "Voronoi", "Delaunay", "Bézier", "Brownian", "Nyquist", "Nesterov",
  "Gram", "Schmidt", "Hausdorff", "Fréchet", "Grassmann", "Stiefel", "Lie", "Frobenius", "Jensen", "Hoeffding", "Chebyshev",
  "Rademacher", "Vapnik", "Chervonenkis", "Occam", "English", "German", "French", "Chinese", "Japanese", "Wikipedia", "GitHub",
];
const keep = new Map(KEEP.map((w) => [w.toLowerCase(), w]));

function mostlyUpperCase(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4) return false;
  return letters.replace(/[^\p{Lu}]/gu, "").length / letters.length >= 0.85;
}

/** An ordinary word (capitalised only at its start) is lowercased; names and acronyms keep their shape. Punctuation around the word is left as it is. */
function lowerWord(token: string): string {
  const m = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u.exec(token);
  const pre = m?.[1] ?? "";
  const core = m?.[2] ?? token;
  const post = m?.[3] ?? "";
  const kept = keep.get(core.toLowerCase());
  if (kept) return pre + kept + post;
  if (/^\p{Lu}[\p{Ll}\p{M}'’]*$/u.test(core)) return pre + core.toLowerCase() + post;
  return token;
}

/**
 * "Intrinsic Dimension of Learned Representations" → "Intrinsic dimension of learned representations".
 * The first letter, the first letter after a colon, acronyms, names with capitals inside, and a short list of
 * eponyms keep their capitals. A title written entirely in capitals is lowercased first.
 */
export function sentenceCase(input: string): string {
  let s = input.replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (mostlyUpperCase(s)) s = s.toLowerCase();
  s = s
    .split(" ")
    .map((word) => word.split(/([-–/])/).map((p, i) => (i % 2 === 0 ? lowerWord(p) : p)).join(""))
    .join(" ");
  return s.replace(/^(\p{L})/u, (m) => m.toUpperCase()).replace(/(:\s+)(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** A PDF's metadata title, when it is a title and not a file name, a template name or a placeholder. */
export function saneMetadataTitle(raw: string | undefined | null): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 4) return null;
  if (/\.(docx?|tex|dvi|pdf|ps|odt|rtf|txt|md)$/i.test(t)) return null;
  if (/^(untitled|microsoft word|no title|title|draft|paper|manuscript|main|arxiv)\b/i.test(t) && t.split(" ").length <= 3) return null;
  if (/[\\/]/.test(t)) return null;
  if (!/\s/.test(t) && /[\d_]/.test(t)) return null;
  if (!/\p{L}/u.test(t)) return null;
  return t;
}

/** Whether a source's current title is just the file it came from: an arXiv number, a slug, a placeholder. */
export function looksLikeFileName(title: string): boolean {
  const t = title.trim();
  return !t || !/\s/.test(t) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(t) || /^untitled$/i.test(t);
}

const SKIP_LINE = /^(arxiv:|preprint|under review|published as a conference paper|accepted|submitted|to appear|proceedings of|journal of|vol\.|volume|copyright|©|\d+$)/i;
const AFFILIATION = /(@|university|institute|department|laborator|school of|college|\bdept\b|\d{4}$)/i;

/** The document's title as its text carries it: the first heading of Markdown, or the opening line of a PDF's first page. */
export function titleFromText(text: string, kind: SourceKind): string | null {
  if (kind !== "pdf") {
    const m = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
    return m?.[1]?.trim() || null;
  }
  const page1 = text.replace(/^<!-- page 1 -->\n?/, "").split(/<!-- page \d+ -->/)[0] ?? "";
  const lines = page1.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i]!;
    if (SKIP_LINE.test(line) || line.split(" ").length < 2 || !/\p{L}/u.test(line)) continue;
    let title = line;
    // A title often wraps onto a second line; take it when it reads as a continuation rather than authors.
    const next = lines[i + 1];
    if (next && title.split(" ").length < 6 && !/[.:!?]$/.test(title) && !AFFILIATION.test(next) && !/,/.test(next) && next.split(" ").length <= 12 && !SKIP_LINE.test(next)) title = `${title} ${next}`;
    return title.split(" ").slice(0, 25).join(" ");
  }
  return null;
}
