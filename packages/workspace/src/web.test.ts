import { describe, expect, it } from "vitest";
import { htmlToArticle } from "./web.js";

const page = `<!doctype html><html><head><title>Manifold hypothesis - Example</title></head><body>
<nav><a href="/">Home</a> · <a href="/about">About</a></nav>
<article>
<h1>Manifold hypothesis</h1>
<p class="byline">By A. Writer</p>
<p>The <b>manifold hypothesis</b> says that real-world high-dimensional data lie near a low-dimensional manifold. It is discussed in <a href="/wiki/Dimensionality_reduction">dimensionality reduction</a>.</p>
<p>A second paragraph long enough for the extractor to keep, with an inline equation like <i>k</i> ≪ <i>d</i> and a <a href="https://example.org/paper">link to a paper</a>. It repeats a few phrases so the article has some body to it, which extractors expect before they will keep it as the main content of the page.</p>
<img src="/img/figure.png" alt="Figure 1">
<h2>Consequences<span class="mw-editsection">[<a href="/w/index.php?action=edit">edit</a>]</span></h2>
<p>Fewer coordinates suffice, as shown in earlier work.<sup><a href="#cite-1">[1]</a></sup> A [bracketed aside] stays readable.</p>
<ul><li>Fewer coordinates are needed.</li><li>Local estimators work.</li></ul>
<table><tr><th>Layer</th><th>k</th></tr><tr><td>18</td><td>24</td></tr></table>
</article>
<footer>© Example</footer>
</body></html>`;

const mathPage = `<!doctype html><html><head><title>Key Concepts in RL — Spinning Up documentation</title></head><body>
<article>
<h1>Key Concepts in RL<a class="headerlink" href="#key-concepts" title="Permalink">¶</a></h1>
<p>A <b>state</b> <img class="math" src="../_images/math/96ac.svg" alt="s"/> is a complete description of the state of the world. There is no information about the world which is hidden from the state. An observation is a partial description of a state, which may omit information, and this paragraph goes on for long enough that the extractor keeps the article.</p>
<div class="math">
<p><img src="../_images/math/73fc.svg" alt="a_t = \\mu(s_t),"/></p>
</div>
<p>or it may be stochastic, in which case it is usually denoted by <img class="math" src="../_images/math/1ae2.svg" alt="\\pi"/>:</p>
<div class="math">
<p><img src="../_images/math/8975.svg" alt="a_t &amp;= \\mu_{\\theta}(s_t) \\\\
a_t &amp;\\sim \\pi_{\\theta}(\\cdot | s_t)."/></p>
</div>
<p>Wikipedia style <span class="mwe-math-element"><span class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display: none;"><math xmlns="http://www.w3.org/1998/Math/MathML" alttext="{\\displaystyle k\\ll d}"><semantics><mrow><mi>k</mi><mo>&#x226A;</mo><mi>d</mi></mrow><annotation encoding="application/x-tex">{\\displaystyle k\\ll d}</annotation></semantics></math></span><img src="https://wikimedia.org/api/rest_v1/media/math/render/svg/123" class="mwe-math-fallback-image-inline mw-invert" alt="{\\displaystyle k\\ll d}"/></span> in a sentence, Sphinx MathJax <span class="math notranslate nohighlight">\\(\\pi_\\theta\\)</span> too, and KaTeX <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="mord">x</span><span class="msupsub">2</span></span></span>.</p>
<img src="/img/figure.png" alt="Figure 1">
</article>
</body></html>`;

const blocksPage = `<!doctype html><html><head><title>Deterministic Policies</title></head><body>
<article>
<h1>Deterministic Policies</h1>
<p>Here is a code snippet for building a simple deterministic policy for a continuous action space in PyTorch, using the <code class="docutils literal notranslate"><span class="pre">torch.nn</span></code> package, followed by enough prose for the extractor to keep this page as an article rather than boilerplate.</p>
<div class="highlight-python notranslate"><div class="highlight"><pre><span></span><span class="n">pi_net</span> <span class="o">=</span> <span class="n">nn</span><span class="o">.</span><span class="n">Sequential</span><span class="p">(</span>
              <span class="n">nn</span><span class="o">.</span><span class="n">Linear</span><span class="p">(</span><span class="n">obs_dim</span><span class="p">,</span> <span class="mi">64</span><span class="p">),</span>
            <span class="p">)</span>
</pre></div></div>
<table class="highlighttable"><tr><td class="linenos"><div class="linenodiv"><pre>1
2</pre></div></td><td class="code"><div class="highlight"><pre><span class="n">a</span> = 1
b = 2
</pre></div></td></tr></table>
<pre><code class="language-js">const x = 1;</code></pre>
<pre>line one<br>line two</pre>
<div class="admonition-you-should-know admonition">
<p class="first admonition-title">You Should Know</p>
<p>Reinforcement learning notation sometimes puts the symbol for state in places where it would be more appropriate to write the symbol for observation.</p>
</div>
<div class="admonition warning"><p>Do not do this at home.</p></div>
<ol><li><p>The value function, which gives the expected return:</p>
<blockquote><div><div class="math"><p><img src="../_images/math/v.svg" alt="V(s) = 1"/></p></div></div></blockquote></li></ol>
<blockquote><p>A real quotation, which stays a quote.</p></blockquote>
<div class="col-span-full grid"><div class="flex flex-col overflow-hidden rounded-md">
<div class="flex items-center justify-between"><span class="text-sm">PR test snippet</span><span class="text-xs text-primary-60">Python</span><button type="button" aria-label="Copy code block"><svg width="16" height="16"><use href="/icons/copy.svg#size-16"></use></svg></button></div>
<div dir="ltr" class="relative flex overflow-auto py-5 style-scrollbars"><code class="flex-1 font-mono CodeBlock-module__syntaxHighlight"><pre class="flex flex-col pe-5"><div class="flex flex-row gap-4"><span class="ms-5 min-w-5 text-end text-primary-44">1</span><div class="flex-1">def test_none_username():</div></div><div class="flex flex-row gap-4"><span class="ms-5 min-w-5 text-end text-primary-44">2</span><div class="flex-1">    assert authenticate(username=None) is None</div></div></pre></code></div>
</div></div>
</article>
</body></html>`;

const macroPage = `<!doctype html><html><head><title>Macros</title>
<script type="text/x-mathjax-config">
MathJax.Hub.Config({ TeX: { Macros: { E: "{\\\\mathrm E}", underE: ["\\\\underset{#1}{\\\\E}\\\\left[ #2 \\\\right]", 2], R: '\\\\mathbb{R}' } } });
</script>
<script>window.MathJax = {"tex": {"macros": {"KL": "\\\\mathrm{KL}", "expect": ["\\\\mathbb{E}_{#1}", 1]}}};</script>
</head><body><article>
<div style="display:none">\\(\\newcommand{\\Var}{\\mathrm{Var}} \\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}\\)</div>
<h1>Macros</h1><p>Some prose, long enough for the extractor to keep this page as an article rather than boilerplate, which it decides by the amount of text it can find in paragraphs like this one.</p>
</article></body></html>`;

describe("web extraction", () => {
  it("recovers the LaTeX macros a page declares for MathJax", () => {
    const a = htmlToArticle(macroPage, "https://example.org/macros.html");
    expect(a.macros).toEqual({
      "\\E": "{\\mathrm E}",
      "\\underE": "\\underset{#1}{\\E}\\left[ #2 \\right]",
      "\\R": "\\mathbb{R}",
      "\\KL": "\\mathrm{KL}",
      "\\expect": "\\mathbb{E}_{#1}",
      "\\Var": "\\mathrm{Var}",
      "\\norm": "\\left\\lVert #1 \\right\\rVert",
    });
  });

  it("keeps code blocks fenced with their language and turns admonitions into titled quotes", () => {
    const a = htmlToArticle(blocksPage, "https://example.org/policies.html");
    expect(a.markdown).toContain("using the \`torch.nn\` package");
    expect(a.markdown).toContain("\`\`\`python\npi_net = nn.Sequential(\n              nn.Linear(obs_dim, 64),\n            )\n\`\`\`");
    expect(a.markdown).toContain("\`\`\`\na = 1\nb = 2\n\`\`\`");
    expect(a.markdown).not.toMatch(/\`\`\`\n1\n2\n\`\`\`/);
    expect(a.markdown).toContain("\`\`\`js\nconst x = 1;\n\`\`\`");
    expect(a.markdown).toContain("\`\`\`\nline one\nline two\n\`\`\`");
    expect(a.markdown).toMatch(/> \*\*You Should Know\*\*\n> ?\n> Reinforcement learning notation/);
    expect(a.markdown).toMatch(/> \*\*Warning\*\*\n> ?\n> Do not do this at home\./);
    expect(a.markdown).not.toContain("obs\\_dim");
    expect(a.markdown).toMatch(/expected return:\s*\$\$\s*V\(s\) = 1\s*\$\$/);
    expect(a.markdown).not.toMatch(/>\s*\$\$/);
    expect(a.markdown).toContain("> A real quotation, which stays a quote.");
    // Row-per-line blocks with a numeric gutter, inside utility-class wrappers Readability would otherwise drop.
    expect(a.markdown).toContain("\`\`\`python\ndef test_none_username():\n    assert authenticate(username=None) is None\n\`\`\`");
    expect(a.markdown).not.toMatch(/\n1def|Copy code block/);
  });

  it("turns formula images, MathML and MathJax spans into LaTeX", () => {
    const a = htmlToArticle(mathPage, "https://example.org/rl_intro.html");
    expect(a.title).toBe("Key Concepts in RL");
    expect(a.markdown).toContain("A **state** $s$ is a complete description");
    expect(a.markdown).toContain("$$\na_t = \\mu(s_t),\n$$");
    expect(a.markdown).toContain("denoted by $\\pi$:");
    expect(a.markdown).toContain("$$\n\\begin{aligned}\na_t &= \\mu_{\\theta}(s_t) \\\\\na_t &\\sim \\pi_{\\theta}(\\cdot | s_t).\n\\end{aligned}\n$$");
    expect(a.markdown).toContain("Wikipedia style $k\\ll d$ in a sentence, Sphinx MathJax $\\pi_\\theta$ too, and KaTeX $x^2$.");
    expect(a.markdown).toContain("![Figure 1](https://example.org/img/figure.png)");
    expect(a.markdown).not.toContain("_images/math");
    expect(a.markdown).not.toContain("¶");
  });

  it("keeps the article, drops chrome, and makes links and images absolute", () => {
    const a = htmlToArticle(page, "https://example.org/wiki/Manifold_hypothesis");
    expect(a.title.toLowerCase()).toContain("manifold hypothesis");
    expect(a.markdown).toContain("**manifold hypothesis**");
    expect(a.markdown).toContain("(https://example.org/wiki/Dimensionality_reduction)");
    expect(a.markdown).toContain("![Figure 1](https://example.org/img/figure.png)");
    expect(a.markdown).toContain("## Consequences");
    expect(a.markdown).toContain("- Fewer coordinates are needed.");
    expect(a.markdown).toMatch(/\| Layer \| k \|/);
    expect(a.markdown).not.toContain("© Example");
    expect(a.markdown).not.toContain("edit");
    expect(a.markdown).toContain("[[1]](https://example.org/wiki/Manifold_hypothesis#cite-1)");
    expect(a.markdown).toContain("A [bracketed aside] stays readable.");
    expect(a.markdown).not.toContain("\\[");
  });
});
