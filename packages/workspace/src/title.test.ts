import { describe, expect, it } from "vitest";
import { looksLikeFileName, saneMetadataTitle, sentenceCase, titleFromText } from "./title.js";

describe("sentenceCase", () => {
  it("lowercases ordinary words and keeps the first letter, acronyms, names with inner capitals and eponyms", () => {
    expect(sentenceCase("Intrinsic Dimension of Learned Representations")).toBe("Intrinsic dimension of learned representations");
    expect(sentenceCase("Testing the Manifold Hypothesis with PCA and TwoNN")).toBe("Testing the manifold hypothesis with PCA and TwoNN");
    expect(sentenceCase("A Bayesian View of Gaussian Processes: A Tutorial")).toBe("A Bayesian view of Gaussian processes: A tutorial");
    expect(sentenceCase("Low-Dimensional Manifolds in ReLU Networks")).toBe("Low-dimensional manifolds in ReLU networks");
    expect(sentenceCase("  ATTENTION IS   ALL YOU NEED ")).toBe("Attention is all you need");
    expect(sentenceCase("GPT-4 Technical Report")).toBe("GPT-4 technical report");
    expect(sentenceCase("")).toBe("");
  });
});

describe("saneMetadataTitle", () => {
  it("accepts a real title and rejects file names, template names and placeholders", () => {
    expect(saneMetadataTitle("Attention Is All You Need")).toBe("Attention Is All You Need");
    expect(saneMetadataTitle("Microsoft Word - paper_final.docx")).toBeNull();
    expect(saneMetadataTitle("paper_final")).toBeNull();
    expect(saneMetadataTitle("Untitled")).toBeNull();
    expect(saneMetadataTitle("C:\\papers\\main.tex")).toBeNull();
    expect(saneMetadataTitle("2301.12345")).toBeNull();
    expect(saneMetadataTitle("")).toBeNull();
    expect(saneMetadataTitle(undefined)).toBeNull();
  });
});

describe("looksLikeFileName", () => {
  it("spots arXiv numbers, slugs and placeholders but not real titles", () => {
    expect(looksLikeFileName("2301.12345")).toBe(true);
    expect(looksLikeFileName("1706.03762v7")).toBe(true);
    expect(looksLikeFileName("attention-is-all-you-need")).toBe(true);
    expect(looksLikeFileName("Untitled")).toBe(true);
    expect(looksLikeFileName("Attention is all you need")).toBe(false);
  });
});

describe("titleFromText", () => {
  it("takes the first heading of Markdown", () => {
    expect(titleFromText("<!-- page 1 -->\n# A Note on PCA and Curved Data\n\nBody.\n", "markdown")).toBe("A Note on PCA and Curved Data");
    expect(titleFromText("<!-- page 1 -->\nno heading here\n", "web")).toBeNull();
  });
  it("takes the opening line of a PDF's first page, joining a wrapped title and skipping the arXiv stamp", () => {
    const text = "<!-- page 1 -->\narXiv:2301.12345v2 [cs.LG] 30 Jan 2023\nIntrinsic Dimension of Learned\nRepresentations in Deep Networks\nAda Okonkwo, Bo Lindqvist\nUniversity of Somewhere\n\n<!-- page 2 -->\nmore\n";
    expect(titleFromText(text, "pdf")).toBe("Intrinsic Dimension of Learned Representations in Deep Networks");
    const oneLine = "<!-- page 1 -->\nTesting the Manifold Hypothesis: A Study.\nJane Doe (MIT)\n";
    expect(titleFromText(oneLine, "pdf")).toBe("Testing the Manifold Hypothesis: A Study.");
    expect(titleFromText("<!-- page 1 -->\n12\n\n", "pdf")).toBeNull();
  });
});
