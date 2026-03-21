import axios from 'axios';

export interface PopulationTimelinePoint {
  timestamp: string;
  playerCount: number;
  mapName: string | null;
}

export interface MapPopularityRound {
  roundId: string;
  mapName: string;
  startTime: string;
  endTime: string | null;
  participantCount: number | null;
}

export interface MapPopularitySummary {
  mapName: string;
  totalRounds: number;
  avgConcurrentPlayers: number;
  avgPlayerDelta: number;
  hourlyAvgPlayers: number[];
}

export interface MapPopularityResponse {
  timeline: PopulationTimelinePoint[];
  rounds: MapPopularityRound[];
  mapSummaries: MapPopularitySummary[];
}

export async function fetchMapPopularity(
  serverGuid: string,
  days: number = 7,
  hourStart?: number,
  hourEnd?: number
): Promise<MapPopularityResponse | null> {
  try {
    const params: Record<string, number> = { days };
    if (hourStart !== undefined && hourEnd !== undefined) {
      params.hourStart = hourStart;
      params.hourEnd = hourEnd;
    }
    const response = await axios.get<MapPopularityResponse>(
      `/stats/data-explorer/servers/${encodeURIComponent(serverGuid)}/map-popularity`,
      { params }
    );
    return response.data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    console.error('Error fetching map popularity:', err);
    throw new Error('Failed to get map popularity data');
  }
}
