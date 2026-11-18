namespace api.Shorts.Models;

/// <summary>Which of a Short's videos a replacement is for: its own (<c>.mp4</c>), the 1080p copy
/// of a roll or recap (<c>.hd.mp4</c>), or the small copy its share link names (<c>.link.mp4</c>).</summary>
public enum ShortVideoCopy
{
    Main,
    Hd,
    Link,
}
