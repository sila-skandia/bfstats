namespace api.PlayerBanners;

public enum BannerStyle
{
    Island,
    Map,
    Plane,
    Tank
}

public static class BannerStyleExtensions
{
    public static bool TryParse(string? input, out BannerStyle style)
    {
        if (Enum.TryParse(input, ignoreCase: true, out BannerStyle parsed))
        {
            style = parsed;
            return true;
        }
        style = BannerStyle.Tank;
        return false;
    }

    public static string FileName(this BannerStyle style) => style switch
    {
        BannerStyle.Island => "island.webp",
        BannerStyle.Map => "map.webp",
        BannerStyle.Plane => "plane.webp",
        BannerStyle.Tank => "tank.webp",
        _ => "tank.webp"
    };
}
