# Neither wing won the wave

Did sitting House Democrats from one wing run ahead of the other in 2026, once you account for the districts they represent? [Read the piece](https://election.run/report/neither-wing-won-the-wave).

```sh
bun src/run.ts --check
```

That prints every number the piece uses, writes [`numbers.json`](numbers.json), and checks each one against [`article.json`](article.json), the numbers the article printed. It takes about 20 seconds, most of it the shuffle check. It needs [Bun](https://bun.sh) and nothing else.

## Code

[`src/run.ts`](src/run.ts) runs in the order the piece reads. [`src/stats.ts`](src/stats.ts) holds the statistics: least squares, errors clustered by state, and R².

| Step | In the piece |
|---|---|
| Score | Each race's score is the Democrat's 2026 two-party margin, minus Harris's 2024 margin in the district, minus the national shift (14.4 points). |
| The two camps | 45 Progressive Caucus members who are not New Democrats, against 75 New Democrats outside the Progressive Caucus plus every Blue Dog. The 28 members of both caucuses are a group of their own. |
| Similar seats | Least squares over sitting members, with the caucus groups as dummies. Controls are the 2024 margin and its square, redrawn lines, the share of the vote still out, night-only counts, how the state's other races went, the member's own 2024 run against the ticket, and the opponent's prior office. Errors are clustered by state, with 95 percent intervals. |
| The read | One model of the score over 275 races, 38 terms in nine blocks. Each block's share is its Shapley value of R² over all 512 subsets of blocks. Place is the seat, state context and composition. Other is the count, prior office, money and small-dollar giving. |
| Random numbers | The exact expected share of as many pure-noise columns as the ideology block keeps. |
| Shuffle check | The real ideology measures, shuffled 200 times among like candidates. |
| Maine | Harris's 2024 margin in Maine plus the national shift, against the Senate race's first-round margin on the same count. |

The 275 races are the ranking pool. A race is in it when the 2024 margin is within 30 points either way, each major candidate has at least 20 percent of the vote, and other candidates have under 10 percent together, and a hand check found no problem with how it is measured.

The article's shuffle figures came from an earlier Python run with its own random seed. This run gives the same 1.6 percent, and more than half the shuffles still do at least as well as the real measures.

## Data

- [`data/analysis_table.csv`](data/analysis_table.csv) has one row per 2026 House race (409 rows, 178 columns), each column defined in [`data/analysis_table_columns.csv`](data/analysis_table_columns.csv).
- [`data/maine.csv`](data/maine.csv) has the Maine Senate and House counts from the same pull, and the 2024 presidential votes in Maine's two districts.

The counts are civicAPI's pull of Nov 8, 2026 at 18:37 UTC. In 13 districts a later AP or state count replaced it (`count_source`). `y_central` is the score on our projection of the final count, which adds estimated outstanding ballots by district. `y_now` is the score on the votes counted so far. The projection is built before this table and is not in this repo.

## Limits

- Counts are not final, and the projection is an estimate.
- The piece compares groups. It cannot say what caused any race's result.
- It covers sitting members only, and says nothing about swapping one kind of nominee for another.
- A share of R² also reflects how much a measure varies across races, not only how much it matters.

## Sources

- Results: civicAPI (civicapi.org), and AP or the state where `count_source` says so.
- 2024 presidential results by district: The Downballot (the-db.co/presbycd).
- 2024 House results and incumbency: Office of the Clerk, US House.
- Voting records: Voteview (DW-NOMINATE).
- Caucus rosters: house.gov, freedomcaucus.org and republicangovernance.com.
- Endorsements: the groups' own sites, and Wikipedia (CC BY-SA 4.0).
- District composition: US Census Bureau.
- Campaign finance: Federal Election Commission (candidate totals only).
