# Acceptance checklist v2 (plan §10)

Status: **auto** = covered by unit/e2e tests, **🧪** = needs a person in Claude Desktop (macOS and Windows), **n/a** = limit noted.
Tick the 🧪 boxes after trying them; report failures with the chat text.

| # | Check | Auto | 🧪 Claude Desktop |
|---|-------|------|-------------------|
| 1 | Install `dist/shalav.mcpb`; "Shalav: my courses" opens the Home card (Hebrew, RTL); no API key asked | pack + `smoke:mcpb`, card e2e he/en | [ ] mac [ ] win |
| 2 | Add 01040195 → catalog label → Add → plan with 66–121 stages; `plan.md` readable | `courseTools.test`, plan validation | [ ] |
| 3 | `104066` → `01040066`; unknown number → manual entry | normalize + lookup tests, add-course e2e | [ ] |
| 4 | Drop a PDF → copied to `חומרי לימוד`; Start indexing; exercises with crops | `fileTools.test`, bundle PDF render | [ ] |
| 5 | Learn: MCQ/open cards; exercise photo → Grade card; Hint 1–3; Show solution | `learnTools/exerciseTools.test`, card e2e | [ ] |
| 6 | Completion only when criteria met; override lists missing + amber badge | `learnTools.test`, lesson e2e | [ ] |
| 7 | New chat → Continue learning recaps the same stage | recap test | [ ] |
| 8 | Practice serves eligible items, generates otherwise, summary | `practiceTools.test` | [ ] |
| 9 | Mistakes in "Watch out for" and in practice | progress/select tests | [ ] |
| 10 | English flips cards to LTR; lessons taught in English | settings test, e2e en | [ ] |
| 11 | Function graph renders as a `plot` in a card | — (figures are stubbed in cards, see DECISIONS) | [ ] n/a likely: host renders it |
| 12 | Data folder in Google Drive on two machines: same courses, no lost events | conflict-copy detection test | [ ] |
| 13 | Claude Code (no cards): add course, index, improve plan via text options | tool visibility test, text fallback | [ ] `claude mcp add shalav -- node server.mjs`; photo grading needs cards |
| 14 | v1 data in `~/Documents/Shalav` opens without migration | v1 settings parse test | [ ] point `data_folder` at it |

Waiting for Claude: every card that waits shows **Nudge Claude** after 20 s, which re-sends "call shalav_next_job".
