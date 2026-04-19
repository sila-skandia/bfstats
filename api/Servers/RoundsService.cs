using api.Players.Models;
using api.PlayerTracking;
using api.Servers.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.Servers;

public class RoundsService(PlayerTrackerDbContext dbContext, ILogger<RoundsService> logger)
{
    public async Task<Players.Models.PagedResult<RoundWithPlayers>> GetRounds(
        int page,
        int pageSize,
        string sortBy,
        string sortOrder,
        RoundFilters filters,
        bool includeTopPlayers = false,
        bool onlySpecifiedPlayers = false)
    {
        var query = dbContext.Rounds.AsNoTracking();

        // Apply filters
        if (!string.IsNullOrWhiteSpace(filters.ServerName))
        {
            query = query.Where(r => r.ServerName.Contains(filters.ServerName));
        }

        if (!string.IsNullOrWhiteSpace(filters.ServerGuid))
        {
            query = query.Where(r => r.ServerGuid == filters.ServerGuid);
        }

        if (!string.IsNullOrWhiteSpace(filters.MapName))
        {
            query = query.Where(r => r.MapName.Contains(filters.MapName));
        }

        if (!string.IsNullOrWhiteSpace(filters.GameType))
        {
            query = query.Where(r => r.GameType == filters.GameType);
        }

        if (!string.IsNullOrWhiteSpace(filters.GameId))
        {
            query = query.Where(r => r.ServerGuid.Contains(filters.GameId));
        }

        if (filters.StartTimeFrom.HasValue)
        {
            query = query.Where(r => r.StartTime >= filters.StartTimeFrom.Value);
        }

        if (filters.StartTimeTo.HasValue)
        {
            query = query.Where(r => r.StartTime <= filters.StartTimeTo.Value);
        }

        if (filters.EndTimeFrom.HasValue)
        {
            query = query.Where(r => r.EndTime >= filters.EndTimeFrom.Value);
        }

        if (filters.EndTimeTo.HasValue)
        {
            query = query.Where(r => r.EndTime <= filters.EndTimeTo.Value);
        }

        if (filters.MinDuration.HasValue)
        {
            query = query.Where(r => r.DurationMinutes >= filters.MinDuration.Value);
        }

        if (filters.MaxDuration.HasValue)
        {
            query = query.Where(r => r.DurationMinutes <= filters.MaxDuration.Value);
        }

        if (filters.MinParticipants.HasValue)
        {
            query = query.Where(r => r.ParticipantCount >= filters.MinParticipants.Value);
        }

        if (filters.MaxParticipants.HasValue)
        {
            query = query.Where(r => r.ParticipantCount <= filters.MaxParticipants.Value);
        }

        if (filters.IsActive.HasValue)
        {
            query = query.Where(r => r.IsActive == filters.IsActive.Value);
        }

        // Filter by player names: require that ALL specified players are present (AND semantics)
        if (filters.PlayerNames != null && filters.PlayerNames.Any())
        {
            var names = filters.PlayerNames
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n.Trim())
                .Distinct()
                .ToList();

            if (names.Count > 0)
            {
                logger.LogInformation("Filtering rounds by ALL player names: {PlayerNames}", string.Join(", ", names));

                // Subquery: find roundIds that contain all requested player names
                var matchingRoundIds = dbContext.PlayerSessions
                    .AsNoTracking()
                    .Where(ps => ps.RoundId != null && names.Contains(ps.PlayerName))
                    .GroupBy(ps => ps.RoundId!)
                    .Where(g => g.Select(ps => ps.PlayerName).Distinct().Count() == names.Count)
                    .Select(g => g.Key);

                query = query.Where(r => r.RoundId != null && matchingRoundIds.Contains(r.RoundId));
            }
        }

        // Apply sorting
        query = sortBy.ToLowerInvariant() switch
        {
            "roundid" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.RoundId)
                : query.OrderByDescending(r => r.RoundId),
            "servername" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.ServerName)
                : query.OrderByDescending(r => r.ServerName),
            "mapname" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.MapName)
                : query.OrderByDescending(r => r.MapName),
            "gametype" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.GameType)
                : query.OrderByDescending(r => r.GameType),
            "endtime" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.EndTime)
                : query.OrderByDescending(r => r.EndTime),
            "durationminutes" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.DurationMinutes)
                : query.OrderByDescending(r => r.DurationMinutes),
            "participantcount" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.ParticipantCount)
                : query.OrderByDescending(r => r.ParticipantCount),
            "isactive" => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.IsActive)
                : query.OrderByDescending(r => r.IsActive),
            _ => sortOrder.ToLowerInvariant() == "asc"
                ? query.OrderBy(r => r.StartTime)
                : query.OrderByDescending(r => r.StartTime)
        };

        // Get total count
        var totalCount = await query.CountAsync();

        // Apply pagination and get rounds
        var rounds = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        // Convert to RoundWithPlayers
        var result = rounds.Select(round => new RoundWithPlayers
        {
            RoundId = round.RoundId,
            ServerName = round.ServerName,
            ServerGuid = round.ServerGuid,
            MapName = round.MapName,
            GameType = round.GameType,
            StartTime = round.StartTime,
            EndTime = round.EndTime ?? DateTime.UtcNow,
            DurationMinutes = round.DurationMinutes ?? 0,
            ParticipantCount = round.ParticipantCount ?? 0,
            IsActive = round.IsActive,
            Team1Label = round.Team1Label,
            Team2Label = round.Team2Label,
            Team1Points = round.Tickets1,
            Team2Points = round.Tickets2,
            Players = new List<SessionListItem>()
        }).ToList();

        // If top players are requested, load top 3 by score in a single query
        if (includeTopPlayers && rounds.Any())
        {
            var roundIds = rounds.Select(r => r.RoundId).Where(id => !string.IsNullOrEmpty(id)).ToList();

            if (roundIds.Any())
            {
                var playerQuery = dbContext.PlayerSessions
                    .AsNoTracking()
                    .Where(ps => ps.RoundId != null && roundIds.Contains(ps.RoundId));

                // Restrict the players list to specified names only if requested
                if (onlySpecifiedPlayers && filters.PlayerNames != null && filters.PlayerNames.Any())
                {
                    var names = filters.PlayerNames;
                    playerQuery = playerQuery.Where(ps => names.Contains(ps.PlayerName));
                }

                // Get all players first, then select top 3 by score per round
                var allPlayers = await playerQuery
                    .OrderBy(ps => ps.RoundId)
                    .ThenByDescending(ps => ps.TotalScore)
                    .Select(ps => new SessionListItem
                    {
                        SessionId = ps.SessionId,
                        RoundId = ps.RoundId!,
                        PlayerName = ps.PlayerName,
                        StartTime = ps.StartTime,
                        EndTime = ps.IsActive ? ps.LastSeenTime : ps.LastSeenTime,
                        DurationMinutes = (int)(ps.LastSeenTime - ps.StartTime).TotalMinutes,
                        Score = ps.TotalScore,
                        Kills = ps.TotalKills,
                        Deaths = ps.TotalDeaths,
                        IsActive = ps.IsActive
                    })
                    .ToListAsync();

                // Group by round and take top 3 by score
                var topPlayersByRound = allPlayers
                    .GroupBy(p => p.RoundId!)
                    .ToDictionary(g => g.Key, g => g.Take(3).ToList());

                foreach (var round in result)
                {
                    if (topPlayersByRound.TryGetValue(round.RoundId, out var topPlayers))
                    {
                        round.TopPlayers = topPlayers;
                    }
                }
            }
        }

        return new Players.Models.PagedResult<RoundWithPlayers>
        {
            Items = result,
            Page = page,
            PageSize = pageSize,
            TotalItems = totalCount,
            TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
        };
    }

    public async Task<List<LiveRoundSummary>> GetLiveRounds(string? game, int limit)
    {
        var cutoff = DateTime.UtcNow.AddHours(-2);
        var normalisedGame = game?.ToLowerInvariant();

        var rawQuery = dbContext.Rounds
            .AsNoTracking()
            .Where(r => r.IsActive && !r.IsDeleted && r.StartTime >= cutoff)
            .Join(dbContext.Servers.AsNoTracking(),
                r => r.ServerGuid,
                s => s.Guid,
                (r, s) => new { Round = r, Server = s });

        if (!string.IsNullOrWhiteSpace(normalisedGame))
        {
            rawQuery = rawQuery.Where(x => x.Server.Game == normalisedGame);
        }

        rawQuery = rawQuery.Where(x => x.Server.IsOnline && x.Server.CurrentNumPlayers > 0);

        var candidates = await rawQuery
            .Select(x => new
            {
                x.Round.RoundId,
                x.Round.ServerGuid,
                x.Round.ServerName,
                x.Server.Country,
                x.Round.MapName,
                x.Round.GameType,
                x.Server.Game,
                x.Round.StartTime,
                x.Round.RoundTimeRemain,
                CurrentPlayers = x.Server.CurrentNumPlayers,
                MaxPlayers = x.Server.MaxPlayers ?? 0,
                x.Round.Tickets1,
                x.Round.Tickets2,
                x.Round.Team1Label,
                x.Round.Team2Label
            })
            .ToListAsync();

        if (candidates.Count == 0)
        {
            return [];
        }

        var roundIds = candidates.Select(c => c.RoundId).ToList();

        var topPlayersByRound = await dbContext.PlayerSessions
            .AsNoTracking()
            .Where(ps => ps.RoundId != null && roundIds.Contains(ps.RoundId) && !ps.IsDeleted && ps.IsActive)
            .Select(ps => new
            {
                ps.RoundId,
                ps.PlayerName,
                Score = ps.TotalScore,
                Kills = ps.TotalKills,
                Deaths = ps.TotalDeaths,
                Team = ps.CurrentTeam
            })
            .ToListAsync();

        var topPlayersDict = topPlayersByRound
            .GroupBy(p => p.RoundId!)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.Score)
                      .Take(3)
                      .Select(x => new LiveRoundTopPlayer(x.PlayerName, x.Score, x.Kills, x.Deaths, x.Team))
                      .ToList());

        var now = DateTime.UtcNow;
        var result = candidates.Select(c =>
        {
            var minutesElapsed = Math.Max(0, (int)(now - c.StartTime).TotalMinutes);
            var drama = ComputeDramaScore(c.Tickets1, c.Tickets2, c.CurrentPlayers, c.MaxPlayers, c.RoundTimeRemain, minutesElapsed);
            topPlayersDict.TryGetValue(c.RoundId, out var topPlayers);
            return new LiveRoundSummary(
                c.RoundId,
                c.ServerGuid,
                c.ServerName,
                c.Country,
                c.MapName,
                c.GameType,
                c.Game,
                c.StartTime,
                minutesElapsed,
                c.RoundTimeRemain,
                c.CurrentPlayers,
                c.MaxPlayers,
                c.Tickets1,
                c.Tickets2,
                c.Team1Label,
                c.Team2Label,
                drama,
                topPlayers ?? []);
        })
        .OrderByDescending(r => r.DramaScore)
        .Take(limit)
        .ToList();

        return result;
    }

    public async Task<List<RecentRoundSummary>> GetRecentRoundSummaries(string? game, int limit, int hoursBack)
    {
        var cutoff = DateTime.UtcNow.AddHours(-hoursBack);
        var normalisedGame = game?.ToLowerInvariant();

        var rawQuery = dbContext.Rounds
            .AsNoTracking()
            .Where(r => !r.IsActive && !r.IsDeleted && r.EndTime != null && r.EndTime >= cutoff)
            .Join(dbContext.Servers.AsNoTracking(),
                r => r.ServerGuid,
                s => s.Guid,
                (r, s) => new { Round = r, Server = s });

        if (!string.IsNullOrWhiteSpace(normalisedGame))
        {
            rawQuery = rawQuery.Where(x => x.Server.Game == normalisedGame);
        }

        var candidates = await rawQuery
            .OrderByDescending(x => x.Round.EndTime)
            .Take(limit * 2)
            .Select(x => new
            {
                x.Round.RoundId,
                x.Round.ServerGuid,
                x.Round.ServerName,
                x.Round.MapName,
                x.Round.GameType,
                x.Server.Game,
                x.Round.StartTime,
                x.Round.EndTime,
                x.Round.DurationMinutes,
                x.Round.ParticipantCount,
                x.Round.Tickets1,
                x.Round.Tickets2,
                x.Round.Team1Label,
                x.Round.Team2Label
            })
            .ToListAsync();

        if (candidates.Count == 0)
        {
            return [];
        }

        var roundIds = candidates.Select(c => c.RoundId).ToList();

        var mvpRaw = await dbContext.PlayerSessions
            .AsNoTracking()
            .Where(ps => ps.RoundId != null && roundIds.Contains(ps.RoundId) && !ps.IsDeleted)
            .Select(ps => new
            {
                ps.RoundId,
                ps.PlayerName,
                Score = ps.TotalScore,
                Kills = ps.TotalKills,
                Deaths = ps.TotalDeaths
            })
            .ToListAsync();

        var mvpByRound = mvpRaw
            .GroupBy(p => p.RoundId!)
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var top = g.OrderByDescending(x => x.Score).FirstOrDefault();
                    return top == null ? null : new RecentRoundMvp(top.PlayerName, top.Score, top.Kills, top.Deaths);
                });

        return candidates
            .Take(limit)
            .Select(c =>
            {
                string? winner = null;
                int? margin = null;
                if (c.Tickets1.HasValue && c.Tickets2.HasValue)
                {
                    var diff = c.Tickets1.Value - c.Tickets2.Value;
                    if (diff > 0)
                    {
                        winner = c.Team1Label ?? "Team 1";
                        margin = diff;
                    }
                    else if (diff < 0)
                    {
                        winner = c.Team2Label ?? "Team 2";
                        margin = -diff;
                    }
                    else
                    {
                        winner = "Draw";
                        margin = 0;
                    }
                }

                mvpByRound.TryGetValue(c.RoundId, out var mvp);

                return new RecentRoundSummary(
                    c.RoundId,
                    c.ServerGuid,
                    c.ServerName,
                    c.MapName,
                    c.GameType,
                    c.Game,
                    c.StartTime,
                    c.EndTime ?? DateTime.UtcNow,
                    c.DurationMinutes ?? 0,
                    c.ParticipantCount ?? 0,
                    c.Tickets1,
                    c.Tickets2,
                    c.Team1Label,
                    c.Team2Label,
                    winner,
                    margin,
                    mvp);
            })
            .ToList();
    }

    private static double ComputeDramaScore(int? t1, int? t2, int currentPlayers, int maxPlayers, int? roundTimeRemain, int minutesElapsed)
    {
        var fillRate = maxPlayers > 0 ? (double)currentPlayers / maxPlayers : 0.0;
        var populationWeight = Math.Min(1.0, currentPlayers / 20.0);

        double closenessScore;
        if (t1.HasValue && t2.HasValue && (t1.Value > 0 || t2.Value > 0))
        {
            var total = (double)(t1.Value + t2.Value);
            var diff = Math.Abs(t1.Value - t2.Value);
            closenessScore = total > 0 ? 1.0 - Math.Min(1.0, diff / total) : 0.5;
        }
        else
        {
            closenessScore = 0.3;
        }

        var urgency = 0.5;
        if (roundTimeRemain.HasValue && roundTimeRemain.Value > 0)
        {
            var remain = roundTimeRemain.Value;
            urgency = remain < 300 ? 1.0 : remain < 900 ? 0.75 : 0.5;
        }
        else if (minutesElapsed > 20)
        {
            urgency = 0.85;
        }

        return Math.Round(closenessScore * 0.5 + fillRate * 0.25 + populationWeight * 0.15 + urgency * 0.10, 4);
    }

    public async Task<SessionRoundReport?> GetRoundReport(string roundId, Gamification.Services.SqliteGamificationService gamificationService)
    {
        // First, get just the round data we need
        var roundData = await dbContext.Rounds
            .AsNoTracking()
            .Where(r => r.RoundId == roundId)
            .Select(r => new
            {
                r.RoundId,
                r.MapName,
                r.GameType,
                r.StartTime,
                r.EndTime,
                r.IsActive,
                r.ParticipantCount,
                r.ServerName,
                r.Tickets1,
                r.Tickets2,
                r.Team1Label,
                r.Team2Label,
                SessionIds = r.Sessions.Select(s => s.SessionId).ToList()
            })
            .FirstOrDefaultAsync();

        if (roundData == null)
            return null;

        // Get all observations for the round with player names
        var roundObservations = await dbContext.PlayerObservations
            .Include(o => o.Session)
            .Where(o => roundData.SessionIds.Contains(o.SessionId))
            .OrderBy(o => o.Timestamp)
            .Select(o => new
            {
                o.Timestamp,
                o.Score,
                o.Kills,
                o.Deaths,
                o.Ping,
                o.Team,
                o.TeamLabel,
                PlayerName = o.Session.PlayerName
            })
            .ToListAsync();

        // Create leaderboard snapshots starting from round start
        var leaderboardSnapshots = new List<LeaderboardSnapshot>();
        var currentTime = roundData.StartTime;
        var endTime = roundData.EndTime ?? DateTime.UtcNow;

        while (currentTime <= endTime)
        {
            // Get the latest score for each player at this time
            var playerScores = roundObservations
                .Where(o => o.Timestamp <= currentTime)
                .GroupBy(o => o.PlayerName)
                .Select(g =>
                {
                    var obs = g.OrderByDescending(x => x.Timestamp).First();
                    return new
                    {
                        PlayerName = g.Key,
                        Score = obs.Score,
                        Kills = obs.Kills,
                        Deaths = obs.Deaths,
                        Ping = obs.Ping,
                        Team = obs.Team,
                        TeamLabel = obs.TeamLabel,
                        LastSeen = obs.Timestamp
                    };
                })
                .Where(x => x.LastSeen >= currentTime.AddMinutes(-1)) // Only include players seen in last minute
                .OrderByDescending(x => x.Score)
                .Select((x, i) => new LeaderboardEntry
                {
                    Rank = i + 1,
                    PlayerName = x.PlayerName,
                    Score = x.Score,
                    Kills = x.Kills,
                    Deaths = x.Deaths,
                    Ping = x.Ping,
                    Team = x.Team,
                    TeamLabel = x.TeamLabel
                })
                .ToList();

            leaderboardSnapshots.Add(new LeaderboardSnapshot
            {
                Timestamp = currentTime,
                Entries = playerScores
            });

            currentTime = currentTime.AddMinutes(1);
        }

        // Filter out empty snapshots
        leaderboardSnapshots = leaderboardSnapshots
            .Where(snapshot => snapshot.Entries.Any())
            .ToList();

        // Get achievements for this round using the dedicated method
        List<Gamification.Models.Achievement> achievements = new();
        try
        {
            achievements = await gamificationService.GetRoundAchievementsAsync(roundId);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to get achievements for round {RoundId}", roundId);
        }

        return new SessionRoundReport
        {
            Session = new SessionInfo(), // Empty since UI doesn't use it
            Round = new RoundReportInfo
            {
                MapName = roundData.MapName,
                GameType = roundData.GameType,
                ServerName = roundData.ServerName,
                StartTime = roundData.StartTime,
                EndTime = roundData.EndTime ?? DateTime.UtcNow,
                TotalParticipants = roundData.ParticipantCount ?? roundData.SessionIds.Count,
                IsActive = roundData.IsActive,
                Tickets1 = roundData.Tickets1,
                Tickets2 = roundData.Tickets2,
                Team1Label = roundData.Team1Label,
                Team2Label = roundData.Team2Label
            },
            LeaderboardSnapshots = leaderboardSnapshots,
            Achievements = achievements
        };
    }
}


