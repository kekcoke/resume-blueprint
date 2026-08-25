{{node}} — {{title}} — is a GATE. It is a {{kind}} node, routed to {{model}}.

Do not implement it. `node qa/plan/next.mjs --ready` will not offer it until
{{decision}} exists, and that file is a human's to approve.

Why it is gated:
{{why}}

What the decision has to settle: {{acceptance}}

Your job in this session is to make that decision cheap for a human to make.
Produce a draft of {{decision}} containing:

1. The question, stated in one sentence.
2. The options, with the concrete consequence of each — not a survey; two or
   three real candidates.
3. A recommendation, with the reasoning that would change your mind.
4. What it commits us to that is hard to walk back. Interfaces especially:
   exit codes, status codes, response shapes and route sets are all things
   callers branch on.
5. Blast radius if we choose wrong, and whether a test would catch it. If a
   test would catch it, say so — that means this should have been a review,
   not a gate.

Relevant paths: {{paths}}
Contract rows this touches: {{rows}}

Write the draft. Do not change anything under packages/. Do not create the
decision record as though it were approved — mark it clearly as a draft
awaiting sign-off, and say plainly what you would need from a human to finish it.
