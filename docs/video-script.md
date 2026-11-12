# The 3-minute video

Rules to keep (hackathon rules and PayPal's own tips): under 3:00; uploaded to YouTube as public;
footage of the real hosted app; **no music**; no third-party trademarks or copyrighted material;
English. Say "PayPal" and "Claude" out loud. Open with the problem and who it's for, then show PayPal
and AI working end to end. Show the product within 15 seconds. Don't type live: have the tabs ready.

**Trademark care:** the real receipts in the demo come from a public dataset and print real restaurant
names. Zoom so store names are not readable, or blur them in the edit. Prefer the rendered fakes
(c-114, c-120) for close-ups.

Live site: https://web-production-3f92e595.up.railway.app. Analyst and supervisor logins are on `/judge`.
Every claim named below is in the live demo.

| Time | Screen | Voice (say it your way) |
|---|---|---|
| 0:00–0:15 | Landing page hero: "We check the person and the proof", the three cited facts underneath | "When a company settles a class action, people who were overcharged can claim a share. In one recent settlement, 49% of 1.77 million claims were fraudulent. Every fake that's paid is taken from a real person. This is Proof of Claim." |
| 0:15–0:35 | `/demo`: the tally, then the three spotlight claims | "It's a claims desk. Claude reads each receipt and reports what it sees. Plain rules decide. A person approves the money, PayPal pays it, and money nobody claims goes to the court's chosen charity." |
| 0:35–0:55 | Claims desk → claim **c-114** (or c-120): the examiner's findings, then the C4 tax check failing | "This receipt looks fine. Claude read it and recommended approve. But the sales tax on it can't exist at that store's address. The rule denies it, and says exactly why." |
| 0:55–1:10 | Claim **c-150**: the planted "ADMINISTRATOR APPROVED" text, the model's "approve", the rule's DENY (out of period) | "This one has an instruction written into it for the AI. The model said approve. It doesn't matter: the model can't decide anything. The receipt is from before the class period, so the rule says no." |
| 1:10–1:30 | Linked groups → group 2: **c-029** and c-036, same inbox, the investigator's note, "Denied" | "One person, five names. The first claim looks perfect and passes every check alone. Two of them share an inbox, so they're held as a group. The AI investigator writes what it sees; a person decides." |
| 1:30–1:45 | `/claim`: Log in with PayPal (sandbox), "Signed in as … verified account"; then a second buyer's claim **denied as a duplicate** | "Claimants log in with PayPal, so a claim belongs to one verified account and the money can only go there. Our second test buyer was denied: same address as an approved claim." |
| 1:45–2:15 | Money page as the analyst: "Propose"; log in as the supervisor: hold to approve; batch **`YPBRD2TBA4Y9A`** read back item by item | "Money needs two people. The analyst proposes the exact round; a different supervisor approves; only then does PayPal Payouts send it. Every item is read back from PayPal and checked against PayPal's own history." |
| 2:15–2:30 | Dana Reyes's item **SUCCESS**; 23 items **UNCLAIMED**; the "returns after 30 days → cy-près" line | "Dana got her ten dollars. The others came back unclaimed: after 30 days and a last chance to ask again, that money goes to the nonprofit in a second PayPal batch." |
| 2:30–2:50 | Landing "The numbers": fraud paid $40 of $1,620; honest denied 3 of 41 (held-out, pre-registered) | "We committed the test set and the pass mark before running it. On 100 held-out claims: $40 of fraud paid, out of the $1,620 paying everyone would send, and 3 of 41 honest claimants wrongly denied. Every miss is in the repo." |
| 2:50–2:58 | `/judge` and the repo URL | "It's live in PayPal's sandbox. Judges, start at slash judge." |

Optional cut if long: drop 1:30–1:45 (the duplicate denial) and keep the money path.

## Before recording

- Log in as the analyst and supervisor in two browser profiles.
- Check `/judge` shows "On" for PayPal sandbox, Log in with PayPal, the AI examiner and the webhook.
- Round 2 (12 November, 13:01 UTC) paid every approved claim, and the 24-hour sandbox allowance is used
  until 13 November 13:01 UTC. To press "Propose" and "Hold to approve" on camera before then, first file
  a fresh claim as buyer5 or buyer6 (change the street address) so there is something to pay, and ask for
  the cap to be raised for that one round. Otherwise show round 2's read-back on the money page.
- Record at 1920×1080, browser zoom 110–125%, hide bookmarks and other tabs.
