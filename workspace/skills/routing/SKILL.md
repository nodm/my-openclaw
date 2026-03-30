# Routing Skill

Choose the right model tier for each task. Default to your current model and escalate only when clearly beneficial.

## Default — MODEL_INTERACTIVE (Gemini 2.5 Flash)
Use for all standard tasks: chat, Q&A, reminders, short writing, brief summaries.

## Escalate to MODEL_MEDIUM (Gemini 2.5 Flash)
Use for longer or more structured tasks that don't require deep reasoning:
- Writing, reviewing, or debugging code
- Multi-step research or information gathering
- Summarising long documents or threads
- Drafting structured content: reports, plans, emails
- Data analysis or transformation

## Escalate to MODEL_REASONING (Gemini 2.5 Pro)
Use when step-by-step reasoning is explicitly needed:
- Mathematical calculations or proofs
- Architecture or system design decisions
- Complex debugging with ambiguous root cause
- The user asks to "think through" or "reason about" something carefully
- Trade-off analysis across competing approaches

## Rules
- Attempt with the current model first; escalate if the response quality is insufficient
- Never use MODEL_SIMPLE — that is reserved for the cron agent
- Spawn a sub-agent with the target model slug from env (`${MODEL_MEDIUM}`, `${MODEL_REASONING}`) when escalating
