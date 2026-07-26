import { apiClient } from './apiClient';

export interface TournamentComment {
  id: number;
  tournamentId: number;
  matchId: number | null;
  content: string;
  authorPlayerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PagedTournamentComments {
  items: TournamentComment[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CommentInput {
  content: string;
  authorPlayerName: string;
  matchId?: number | null;
}

class TournamentCommentsService {
  private baseUrl = '/stats/tournaments';

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) errorMessage = errorData.message;
      } catch {
        // Ignore JSON parsing errors
      }
      throw new Error(errorMessage);
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  async getComments(
    tournamentIdOrName: string | number,
    options: { matchId?: number | null; page?: number; pageSize?: number } = {}
  ): Promise<PagedTournamentComments> {
    const params = new URLSearchParams();
    if (options.matchId != null) params.set('matchId', String(options.matchId));
    params.set('page', String(options.page ?? 1));
    params.set('pageSize', String(options.pageSize ?? 10));

    const url = `${this.baseUrl}/${encodeURIComponent(tournamentIdOrName)}/comments?${params.toString()}`;
    const response = await apiClient.get(url);
    return this.handleResponse<PagedTournamentComments>(response);
  }

  async createComment(
    tournamentIdOrName: string | number,
    input: CommentInput
  ): Promise<TournamentComment> {
    const url = `${this.baseUrl}/${encodeURIComponent(tournamentIdOrName)}/comments`;
    const response = await apiClient.post(url, input, { requiresAuth: true });
    return this.handleResponse<TournamentComment>(response);
  }

  async editComment(
    tournamentIdOrName: string | number,
    commentId: number,
    input: CommentInput
  ): Promise<TournamentComment> {
    const url = `${this.baseUrl}/${encodeURIComponent(tournamentIdOrName)}/comments/${commentId}`;
    const response = await apiClient.request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      requiresAuth: true,
    });
    return this.handleResponse<TournamentComment>(response);
  }

  async deleteComment(tournamentIdOrName: string | number, commentId: number): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(tournamentIdOrName)}/comments/${commentId}`;
    const response = await apiClient.delete(url, { requiresAuth: true });
    return this.handleResponse<void>(response);
  }
}

export const tournamentCommentsService = new TournamentCommentsService();
