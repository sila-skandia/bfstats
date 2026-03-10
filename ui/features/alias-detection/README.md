# Alias Detection Feature

## Overview

The Alias Detection feature provides investigators and admins with a comprehensive tool to identify potential alternate accounts by analyzing player behavioral patterns, statistics, and activity timelines.

## Pages & Components

### Main View: `AliasDetectionView.vue`
- **Route**: `/alias-detection`
- **Purpose**: Container for the entire alias detection workflow
- **Features**:
  - Search section for inputting two player names
  - Display area for analysis results
  - Error and empty states

### Form Component: `AliasDetectionForm.vue`
- **Purpose**: Collect two player names for comparison
- **Features**:
  - Player input fields with autocomplete suggestions
  - Visual "vs" separator between inputs
  - Analysis button with loading state
  - Form validation

### Report Component: `AliasDetectionReport.vue`
- **Purpose**: Display comprehensive analysis results
- **Sections**:
  1. **Overall Score Circle** - Color-coded suspicion level (Very Likely, Likely, Potential, Unrelated)
  2. **Analysis Grid** - Four cards showing:
     - Statistical Profile (K/D ratio, kill rate, map/server performance)
     - Behavioral Patterns (play times, server affinity, ping consistency)
     - Network Relationships (shared teammates, direct connections)
     - Temporal Consistency (co-sessions, activity overlap)
  3. **Evidence Sections** - Red flags and green flags highlighting suspicious/innocent patterns
  4. **Activity Timeline** - Visual representation of account activity windows and switchover gaps

## Data Flow

```
User Input → AliasDetectionForm
    ↓
aliasDetectionService.comparePlayersAsync()
    ↓
GET /api/stats/alias-detection/compare?player1=X&player2=Y
    ↓
PlayerAliasSuspicionReport (response)
    ↓
AliasDetectionReport (display)
```

## Design Aesthetic

**Theme**: Forensic Investigation Dashboard
- **Color Scheme**: Dark tones (slate/blue grays) with strategic color accents
  - 🔴 Red (#ef4444) - Very likely alias / high suspicion
  - 🟠 Orange (#ea580c) - Likely alias / moderate suspicion
  - 🟡 Yellow (#ca8a04) - Potential alias / low suspicion
  - 🟢 Green (#16a34a) - Unrelated / low risk
- **Typography**: System fonts with clear hierarchy
- **Layout**: Card-based grid with detailed metrics
- **Visual Details**: Progress bars, confidence indicators, badge systems
- **Animations**: Smooth loading states, subtle transitions

## Technical Implementation

### Types (`alias-detection.ts`)
- `PlayerAliasSuspicionReport` - Main response type
- `StatSimilarityAnalysis` - Statistical comparison results
- `BehavioralAnalysis` - Behavioral pattern results
- `NetworkAnalysis` - Network relationship results
- `TemporalAnalysis` - Temporal consistency results
- `ActivityTimeline` - Account activity visualization data

### Service (`aliasDetectionService.ts`)
- `comparePlayersAsync(player1, player2, lookBackDays)` - Single comparison
- `findPotentialAliasesAsync(targetPlayer, candidates, lookBackDays)` - Batch comparison

### API Endpoints
- `GET /api/stats/alias-detection/compare` - Compare two players
- `POST /api/stats/alias-detection/batch` - Compare one player against many

## Suspicion Levels

| Score | Label | Emoji | Interpretation |
|-------|-------|-------|-----------------|
| 0.0 - 0.49 | Unrelated | 🟢 | Very unlikely to be the same person |
| 0.50 - 0.69 | Potential | 🟡 | Could be related, worth investigating |
| 0.70 - 0.84 | Likely | 🟠 | Probably the same person |
| 0.85 - 1.0 | Very Likely | 🔴 | Almost certainly the same person |

## Data Sufficiency

Each analysis dimension tracks whether it has sufficient data:
- **Stat Analysis**: Requires player stats from both accounts
- **Behavioral Analysis**: Requires session data from both accounts
- **Network Analysis**: Requires Neo4j teammate data (only 30-day backfill)
- **Temporal Analysis**: Requires Neo4j activity history
- **Switchover Analysis**: Valid for gaps ≤ 30 days only

Insufficient dimensions are excluded from the overall score calculation, which is then re-weighted based on available data.

## Mobile Responsiveness

- Score circle and header stack vertically on mobile
- Analysis grid converts to single column layout
- Timeline section adapts for smaller screens
- All interactive elements have sufficient touch targets

## Error Handling

- Invalid player names → Clear validation message
- Network errors → User-friendly error state
- Timeout (>30s) → Suggest retrying
- Server errors → Generic error message with retry option

## Future Enhancements

- [ ] Batch analysis UI for comparing one player against multiple candidates
- [ ] Historical analysis - compare players at different time periods
- [ ] Export reports as PDF
- [ ] Admin notes/flags system
- [ ] Integration with moderation dashboard
- [ ] Confidence interval visualizations
