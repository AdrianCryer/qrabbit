# Research Exploration Client — Product Brief

## 1. Concept

Build a standalone desktop research/learning client for exploring difficult material with AI.

The central interaction is:

> **Read → encounter something interesting/confusing → highlight → explore in a branch → understand → return to the original thread.**

The goal is not to build another generic AI chat or paper summarizer. The distinctive idea is to treat **questions, explorations, source passages, and understanding as persistent first-class objects**.

Working name ideas include **QRabbit**, **Rabbit**, **Burrow**, **Tangent**, etc. Naming is unresolved.

---

## 2. Core Problem

When reading research papers, technical documentation, books, etc., understanding tends to become fragmented.

A reader encounters:

> “The representation lies on a low-dimensional manifold.”

They want to investigate “low-dimensional manifold”, then perhaps discover they need to understand intrinsic dimensionality, then PCA, then nonlinear embeddings.

In a normal chat, this becomes a long linear conversation and the original research context gets polluted by increasingly tangential questions.

The desired experience is instead:

```text
Main research thread
        │
        ├── Highlighted passage
        │
        └── Explore
              │
              ├── Question
              │
              ├── Follow-up
              │
              └── Deeper question
                     │
                  Understand
                     │
                     └── Return to main thread
```

The branch should remain attached to the exact source passage that triggered it.

---

## 3. Core UX

### Research workspace

A user creates a research workspace/project.

Sources can include:

* PDFs
* Web pages / URLs
* Markdown/text
* Potentially other documents later

Each source has a reader/viewer.

### Highlight → Explore

The user highlights a phrase or passage.

Actions could include:

* Explain
* Ask a question
* Explore
* Find related material
* Add note
* Generate flashcard

The important action is **Explore**.

Selecting it creates a new branch attached to that exact source span.

### Branching exploration

Each exploration is a small conversation/tree rather than one global chat.

Example:

```text
Paper
 └── "low-dimensional manifold"
       └── What does this mean?
             └── How is this different from PCA?
                   └── Can you give me an example?
```

Branches can be collapsed.

The user can return to the parent/main thread at any point.

The system should preserve the exploration history without forcing it into the main conversation.

### Understanding state

The user should be able to indicate:

> “I understand this now.”

This closes/resolves the branch while preserving its history.

Potential future states:

* unexplored
* exploring
* understood
* revisit/review

Do not over-design this initially.

---

## 4. Claude / AI Integration

Claude should be treated as an agent operating over the research workspace, rather than simply as a chat API.

Potential architecture:

```text
                Research Client
                      │
          ┌───────────┴───────────┐
          │                       │
      Source data             Research graph
          │                       │
          └───────────┬───────────┘
                      │
                     MCP
                      │
                 Claude Code
```

The AI should be able to access:

* current source
* source passages
* highlights
* current branch
* parent branches
* related questions
* previous explanations
* notes/conclusions
* other sources in the workspace

Claude Code is particularly attractive because the research workspace can be represented as structured persistent state rather than hidden inside a chat application.

The system should ideally remain model-agnostic over time.

---

## 5. Persistent Research Graph

The most important architectural principle:

**Do not make chat history the fundamental data model.**

The following should be first-class entities:

* Source
* Document
* Section
* Text span
* Highlight
* Question
* Answer/explanation
* Exploration branch
* Concept
* Note
* Relationship
* Understanding/resolution state
* Flashcard

A simplified structure:

```text
Source
 └── Section
      └── Span
           └── Highlight
                └── Exploration
                     ├── Question
                     ├── Answer
                     ├── Child question
                     ├── Related concept
                     └── Understanding state
```

This allows the same underlying research graph to eventually be accessed by different clients/agents.

---

## 6. Learning / Flashcards

Flashcards should not initially be treated as generic “generate 20 cards from this paper”.

A more interesting approach is **question-driven learning**.

If the user repeatedly struggles with a concept, the system can suggest turning it into a flashcard.

For example:

```text
Concept: Low-dimensional manifold

Encountered:
- Paper A → user asked about it
- Paper B → user asked about it again
- Paper C → user asked for an example

→ Suggest creating a flashcard
```

Cards should ideally reflect the user's actual confusion and understanding rather than merely extracting facts from the source.

Potential future functionality:

* spaced repetition
* review based on previously difficult concepts
* automatically generated questions
* “teach this back to me”
* prerequisite checks

---

## 7. Resource-Level Intelligence

A major longer-term opportunity is that the research graph becomes useful **to the resources themselves**, not just the learner.

Across many users, the system could identify:

* passages that frequently cause questions
* concepts people repeatedly misunderstand
* common prerequisite gaps
* types of explanations that resolve confusion
* where readers abandon a thread
* what concepts tend to be explored together
* different patterns of prior knowledge

For example:

```text
Paper Section 4
    ↓
47% of exploratory questions originate here

Common concepts:
    31% — adjoint method
    19% — continuous dynamics
    14% — backpropagation through ODEs
```

This could eventually produce a **difficulty/understanding map for a resource**.

It could also identify prerequisite chains:

```text
dimension
   ↓
manifold
   ↓
intrinsic dimension
   ↓
manifold hypothesis
```

This is potentially valuable to authors, educators, researchers and publishers.

Important distinction:

The system should primarily learn **what readers struggle with**, rather than trying to infer sensitive personal characteristics about who they are.

Reader behaviour/questions are likely to be more useful than demographic profiling.

---

## 8. Potential Future Features

Do not build these initially, but preserve architectural room for them.

### Related research

When exploring a question:

* find relevant papers
* find supporting/contradicting evidence
* follow citations
* connect concepts across sources

### Concept graph

Automatically identify recurring concepts across papers.

```text
Paper A ──┐
          ├── Self-attention
Paper B ──┘
              │
              ├── Transformer
              └── Positional encoding
```

### Prerequisite recommendations

If a user repeatedly encounters a concept they don't understand:

> “You may want to understand X before continuing.”

### Research memory

Remember what the user has already established.

Avoid repeatedly explaining concepts the user has already understood unless requested.

### Multiple agents/models

Potentially allow Claude, other models, or specialised agents to operate over the same persistent research graph.

### Collaborative / aggregate learning data

Eventually, anonymised aggregate exploration data could improve explanations and reveal difficult portions of resources.

This should be designed with privacy and consent in mind from the beginning.

---

## 9. MVP Scope

Keep the first version deliberately small.

### Must have

1. Standalone desktop client
2. PDF/document reader
3. Source ingestion
4. Text selection/highlighting
5. “Explore” action on a highlight
6. Branching question/exploration tree
7. Claude integration
8. Persistent workspace state
9. Ability to collapse/return from a branch
10. Mark branch/concept as understood

### Nice to have

* URL ingestion
* source citations
* Markdown notes
* automatic related concepts
* basic flashcard generation

### Explicitly defer

* sophisticated spaced repetition
* social features
* author analytics
* complex knowledge graph visualisation
* elaborate user profiles
* recommendation engine
* multi-agent orchestration
* full publishing/educator platform

The first question to validate is simply:

> **Does branching exploration anchored to source material make difficult reading meaningfully better than a normal AI chat?**

---

## 10. Product Philosophy

The product should encourage curiosity rather than prevent distraction.

A rabbit hole is not necessarily a problem.

The problem is **losing your way back**.

The product should therefore make it cheap to:

1. Follow curiosity.
2. Go arbitrarily deep.
3. Preserve exactly what was learned.
4. Return to the original context.
5. Continue reading.

This is the central interaction to optimise around.

---

## 11. Naming

Current naming exploration:

* QRabbit
* Rabbit
* Rabbithole
* Rabbithink
* Rabbitwise
* Burrow
* Warren
* Tangent
* Digress
* Delve
* Fathom

**QRabbit** is particularly interesting because Q can simultaneously suggest:

* question
* query
* curiosity
* quest

Conceptually:

> **Question → Rabbit hole → Understanding**

The final name is not decided.

---

## 12. Initial Technical Direction

Prefer a local-first architecture where practical.

Potential model:

```text
Desktop Client
    │
    ├── Source store
    ├── Research graph
    ├── Local search/index
    └── MCP interface
             │
             ↓
        Claude Code
```

The persistence layer should make the research graph portable and inspectable rather than locking it into a proprietary chat transcript.

A key design goal is that **the underlying research state should remain useful even if the AI model changes**.

---

## 13. Success Criteria

The MVP succeeds if a researcher can:

1. Open a difficult paper.
2. Encounter something they don't understand.
3. Highlight it.
4. Ask a question.
5. Follow several levels of related questions without cluttering the main thread.
6. Eventually reach understanding.
7. Return to the exact place they left.
8. Later recover the exploration and what they learned.

If that interaction feels substantially better than opening a separate Claude/ChatGPT conversation, the concept has something worth building on.
