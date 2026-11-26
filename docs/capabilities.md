# Capability manifest and freshness

`GET /capabilities.json` publishes the versioned contract
`media-studio-capabilities` (`version: 1`). It lists the enabled models, their
exact provider endpoints, supported frames and durations, planning costs, the
retired models that old jobs may still name, adapter versions and the stable
migration alerts from the most recent read-only check.

This file is a public description, not a provider invoice and not authority to
run inference. A saved job keeps its own `model` and `modelEndpoint` in its
request record, so a later catalogue change does not rewrite its attribution.

## Refresh

The Studio's existing every-minute cron calls a refresh at most once every 24
hours. The same read-only check can be run by an owner from the studio:

```sh
curl -X POST https://media.loftwah.com/api/capabilities/refresh \
  -H 'cookie: studio_session=…'
```

The refresh reads:

- each enabled Workers AI model's public Cloudflare documentation page for a
  planned deprecation date, unit price and schema availability;
- fal's public model search for each enabled fal endpoint, including its
  `deprecated`, `removed`, status and pricing description;
- `https://models.dev/api.json` as a public provider-discovery source.

It never calls inference, changes a production default, buys credit or writes a
GitHub issue. A failed or unreadable source keeps the previous manifest as the last good copy
and records a `schema` alert. Cloudflare Markdown must identify the exact model
endpoint (preferably through its Model ID block); fal and models.dev responses
must have their expected object shape. A malformed or unrelated HTTP 200 is
treated as unreadable, cannot advance `lastGoodAt`, and cannot dismiss
outstanding alerts. A changed price records one `pricing` alert. A published
retirement records one `retirement` alert. Alert IDs are stable and
de-duplicated, and the source records preserve the first time the problem was
seen.

Partial refreshes retain the last valid model facts for unreadable sources.
`checkedAt` identifies the current attempt, and `factsCheckedAt` identifies
when the retained facts were read. Outstanding pricing and retirement alerts
remain visible. A pricing alert stays open
across A→B→B observations: it keeps the reviewed baseline (A) as `previous`,
updates `current` to the latest observed price (B), and preserves its original
`firstSeenAt`. A fresh observation of the baseline price resolves the alert.
Retirement alerts stay actionable while the same model endpoint stays enabled.
A recovered source clears its unreadable-source alert when it returns readable evidence.

A person still reviews the alert, qualifies any replacement against the adapter,
frames, cost and a real output, and ships the change through the normal Studio
and Composer release path. The daily check is a maintenance aid, not an
automatic model promotion.

## Retirement of Studio Draft (SDXL Lightning)

Cloudflare publishes 20 November 2026 as the planned deprecation date for
`@cf/bytedance/stable-diffusion-xl-lightning`. New work uses
`@cf/black-forest-labs/flux-2-klein-9b` as **Studio Draft · FLUX.2 Klein 9B**
(`studio-craft`). The old `studio-draft` selection is retired: it is not in the
enabled catalogue, a new request returns `410 model_retired` with the
replacement, and saved jobs still display **Studio Draft · SDXL Lightning
(retired)** with their exact endpoint. Composer accepts an imported older media
spec, maps `studio-draft` to `studio-craft` and shows the recovery notice before
the draft is saved.

Qualification on 15 November 2026 used the same multipart shape as Darkroom's
Cloudflare provider: one 1024 × 1280 portrait product plate, 519,884 bytes,
executed through the Workers AI binding. The machine-readable receipt and the
output are in the ignored `output/capability-qualification-20261115/` directory.
The planning estimate is US$0.016 for a 1.25 MP frame at the published
US$0.015 first-megapixel plus US$0.002 per extra megapixel rate; it is not an
invoice.
