# Limitations

What Proof of Claim does not prove, and where it is known to be wrong. Every number links back to
[`docs/methodology.md`](docs/methodology.md) or the committed results in `packages/eval/results/`.

## The evidence behind the numbers

- **The fraud is synthetic.** Fakes are rendered receipts and edited real receipts made for this
  project. Real fraudsters may make mistakes these don't, and avoid ones these make.
- **The settlement is fictional,** with one product class (non-alcoholic drinks at restaurants), nine
  states and a 2015–2019 class period.
- **The honest set is small.** The held-out run has 41 honest claimants, so "3 of 41 wrongly denied"
  has a 95% interval of 2.5–19.4%. One run per model.
- **Real receipts come from one public dataset** (ExpressExpense SRD): restaurant receipts only, dated
  about 2015–2019, many low resolution (73 of 200 under 600 px wide). The images are public, so a model
  may have seen them in training.
- **The labels were transcribed with AI help.** Receipts were transcribed in a Claude Code session, not
  by a person; the examiner is also Claude, so a misreading both make the same way would not show up as
  an error. Receipts whose numbers didn't add up were checked by eye and 4 were corrected.
- **"Honest" means a real receipt, not a real claimant.** Nobody filed these as claims.

## Known errors, kept on purpose

- **Duplicate-image false positive (C6).** Two different rendered receipts can hash within the
  duplicate threshold, because every render shares one layout. Honest claims c-115 (pilot), c-136 and
  c-155 (held-out) were denied as duplicates. Real receipts printed by the same store's till could
  collide the same way. The owner kept decision table v1 unchanged rather than tune it after seeing
  results.
- **No-receipt fraud gets through the eval.** Four no-receipt fraud claims were paid $10 each in the
  held-out run. In the app, one claim per verified PayPal account stops one person using five names
  with one account; it does not stop someone who controls several verified PayPal accounts.
- **A flawless fake passes.** A fake receipt whose date, store, items, arithmetic and tax rate are all
  consistent passes every document check. That is why identity (Log in with PayPal) and linked-group
  checks exist, and why we don't claim to detect AI-made images.

## Fraud rings

Measured on a held-out set of 5,000 synthetic claims (rings-v2):

- **Address mills are almost never caught: 2 of 304** ring claims grouped. A shared building only counts
  towards joining a group, by design, so that families and dorms aren't flagged on address alone.
- **Households are held most:** 194 of 704 honest household claimants (27.6%) were held for a person.
  A group is held for a person, never denied by the code, for this reason.
- The AI investigator wrongly recommended clearing fraud groups in its first two designs
  (`docs/methodology.md`). It only recommends; a person decides every group.

## The deployed demo

- **PayPal sandbox only.** The PayPal client refuses any address but the sandbox (or a local test
  stand-in). Production Payouts would need PayPal's approval for the account.
- **One shared demo.** Every visitor sees what earlier visitors approved or sent. A private copy per
  visitor (plan item P47) was not built.
- **PayPal's history lags.** On 11 November the sandbox's Transaction Search stopped refreshing for over
  five hours; payouts show "waiting for history" until it catches up.
- **AI spend is capped** at $1 per server start on the public demo. After that, receipt claims go to a
  person unread.
- **Sandbox buyers share one address.** PayPal gives every sandbox test buyer the same default address,
  so a second sandbox buyer is denied as a duplicate unless the address is changed on the form.
- **Licences.** AG Studio and Bryntum run on trial licences (evaluation use, until 2026-12-25).
- **Translations** (Spanish, Hindi) have not been reviewed by native speakers.
- The deploy-time eval gate re-scores the recorded pilot run; it does not re-run the model.

## Not built

- Purchase proof from the merchant's own PayPal records (plan item C5): researched and recorded in
  `docs/architecture.md`, not built. Card purchases in the sandbox all carry one shared payer ID, so they
  can't show who bought.
- No real claims administrator or court has used this. It is not legal advice.
