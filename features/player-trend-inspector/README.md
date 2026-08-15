# Player trend inspector

K/D and kill-rate graphs on the player details overview used to be
read-only 56px sparklines. They now share a zoomable time window, a
fullscreen inspector, and a rounds listing that slides in for the
selected period.

## Interaction model

1. **Hover** still reads a single bucket (date + value).
2. **Drag horizontally** across either sparkline to select a slice.
   On release the visible series is that window, Y-axis refits, and a
   range chip appears (`12 Mar – 28 Apr · Reset · View N rounds`).
3. Dragging again zooms further. **Wider** pops one level; **Reset**
   returns to the full career.
4. **Expand** opens a fullscreen inspector: career overview strip
   (brush here *replaces* the window) plus tall K/D and kill-rate
   charts that share the same span.
5. **View rounds** slides in the player's rounds for that window
   (same motion as Wrapped round reports). Click a row to slide the
   round report on top. **Open sessions page** is the durable link:
   `/v4/players/:name/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD`.

K/D and kill rate always share the window — they are two readings of
the same career, not independent zooms.

## Files

| File | Role |
| --- | --- |
| `ui/src/components/v4/MmSparkline.vue` | Brush selection + window highlight |
| `ui/src/components/v4/MmPlayerTrendPanel.vue` | Shared zoom, fullscreen, CTAs |
| `ui/src/components/v4/MmTrendRoundsSlideover.vue` | Period rounds + nested report |
| `api/Players/Models/TrendDataPoint.cs` | `SessionCount` so the chip can show round volume without a prefetch |

## Notes

- Brush on touch only commits when the gesture is clearly horizontal,
  so the page can still scroll.
- Escape closes the innermost overlay (report → rounds → fullscreen).
- Sessions-page `from`/`to` query params hydrate the existing date
  filters; the slideover itself queries `/stats/rounds` with ISO bounds
  for the UTC buckets behind the daily trend.
