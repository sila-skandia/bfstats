namespace api.Recordings.Models;

/// <summary>
/// One piece of a round fingerprint (<see cref="RoundFingerprint"/>): what an event every
/// client of the round receives says, hashed, and when the recording has it, in milliseconds
/// of its own clock. The hash's top bit marks a player key (a kill, a join, a leave, a global
/// chat line); clear, it is an object made during play. Its low 31 bits decide whether a
/// fingerprint that had to be sampled keeps it.
/// </summary>
public readonly record struct RoundKey(uint Hash, int Millis)
{
    public const uint PlayerBit = 0x80000000;

    public bool IsPlayer => (Hash & PlayerBit) != 0;

    /// <summary>The low 31 bits, which sampling compares.</summary>
    public uint Sampled => Hash & ~PlayerBit;
}
