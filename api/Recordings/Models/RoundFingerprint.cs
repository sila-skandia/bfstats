using System.Buffers.Binary;

namespace api.Recordings.Models;

/// <summary>
/// What a recording says of its round that another client's recording of the same round
/// says too (features/replay-feed, "Rounds"): its keys in time order, and the stretch of its
/// own clock they come from. A fingerprint with more keys of a kind than it keeps holds only
/// those whose low 31 bits fall below that kind's sample, the same keys in every recording,
/// so two fingerprints compare over the smaller of their two samples.
/// </summary>
public sealed record RoundFingerprint(
    IReadOnlyList<RoundKey> Keys,
    uint PlayerSample,
    uint ObjectSample,
    double LiveFromSeconds,
    double LiveToSeconds)
{
    /// <summary>Every key of a kind is kept.</summary>
    public const uint Everything = 0x80000000;

    private const int KeyBytes = 8;

    public int PlayerKeyCount => Keys.Count(k => k.IsPlayer);

    /// <summary>The keys as stored: eight bytes each, the hash then the milliseconds, little-endian.</summary>
    public byte[] PackKeys()
    {
        var bytes = new byte[Keys.Count * KeyBytes];
        for (var i = 0; i < Keys.Count; i++)
        {
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(i * KeyBytes), Keys[i].Hash);
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan((i * KeyBytes) + 4), Keys[i].Millis);
        }
        return bytes;
    }

    public static IReadOnlyList<RoundKey> UnpackKeys(byte[] bytes)
    {
        var keys = new RoundKey[bytes.Length / KeyBytes];
        for (var i = 0; i < keys.Length; i++)
        {
            keys[i] = new RoundKey(
                BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i * KeyBytes)),
                BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan((i * KeyBytes) + 4)));
        }
        return keys;
    }
}
