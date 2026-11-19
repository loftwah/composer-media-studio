# Private saved outcomes

Studio Library → Saved outcomes reads the last seven complete UTC days for the selected project. The owner or an existing admin grant for that project can download the same v1 JSON. The private `GET /api/projects/:id/creator-outcomes` endpoint also accepts `from` and `until` calendar dates for 1–30 complete UTC days. The start is inclusive and the end is exclusive. A failed refresh leaves the previous capture marked stale. A sign-in or access failure clears it.

| Metric key | Unit | Qualifying record |
| --- | --- | --- |
| `saved_provider_outputs` | `saved_outputs` | A saved provider job with a completion time in the window and a retained, same-project asset linked in both directions. Count each output asset once. |
| `saved_local_exports` | `saved_exports` | A retained same-project asset saved in the window and within the validity of its matching local-render or footage-export receipt. Count each output asset once across the two receipt paths. |
| `publication_published` | `publication_transitions` | One changed bulk publish audit row in the window. |
| `publication_unlisted` | `publication_transitions` | One changed bulk unlist audit row in the window. |
| `publication_withdrawn` | `publication_transitions` | One changed bulk withdrawal audit row in the window. |

The metric definitions are version 1. Counts describe recorded paths and carry `partial` status. Committed portable restores have unavailable metrics with `null` values until support can distinguish imported history from new work. The watermark is the latest qualifying timestamp in this capture, or `null`. Earlier reliable coverage has not been established for every metric. Stored metadata and audit rows establish server-side evidence. These counts do not measure decoded file quality, satisfaction, downloads, local-only work, all individual or automatic publication activity, or provider costs.

The aggregate contains no asset records, prompts, filenames, actor details, media links or private costs. It does not enable public reporting. A Composer adapter must preserve the original units, UTC bounds and evidence level. Public exposure requires the separate consent and withdrawal path in Composer #613.
