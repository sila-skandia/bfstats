using api.Bflist.Models;

namespace api.PlayerTracking
{
    public interface IGameServer
    {
        string Guid { get; }
        string Ip { get; }
        int Port { get; }
        string Name { get; }
        string GameId { get; }
        string MapName { get; }
        string GameType { get; }
        int? Tickets1 { get; }
        int? Tickets2 { get; }
        int? MaxPlayers { get; }
        int NumPlayers { get; }
        string? JoinLink { get; }
        int? RoundTimeRemain { get; }
        IEnumerable<PlayerInfo> Players { get; }
        IEnumerable<TeamInfo> Teams { get; }
    }

    public class Bf1942ServerAdapter(Bf1942ServerInfo serverInfo) : IGameServer
    {
        public string Guid => serverInfo.Guid;
        public string Ip => serverInfo.Ip;
        public int Port => serverInfo.Port;
        public string Name => serverInfo.Name;
        public string GameId => serverInfo.GameId;
        public string MapName => serverInfo.MapName;
        public string GameType => serverInfo.GameType;
        public int? Tickets1 => serverInfo.Tickets1;
        public int? Tickets2 => serverInfo.Tickets2;
        public int? MaxPlayers => serverInfo.MaxPlayers;
        public int NumPlayers => serverInfo.NumPlayers;
        public string? JoinLink => serverInfo.JoinLink;
        public int? RoundTimeRemain => serverInfo.RoundTimeRemain;

        public IEnumerable<PlayerInfo> Players => serverInfo.Players ?? [];
        public IEnumerable<TeamInfo> Teams => serverInfo.Teams ?? [];
    }

}
