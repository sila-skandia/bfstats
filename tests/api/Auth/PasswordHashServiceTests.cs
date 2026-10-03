using api.Auth;
using Microsoft.Extensions.Configuration;

namespace api.tests.Auth;

public class PasswordHashServiceTests
{
    private readonly PasswordHashService _service = new();

    [Fact]
    public void Hash_UsesSaltedFormat_WithRandomSalt()
    {
        var a = _service.Hash("correct horse battery staple");
        var b = _service.Hash("correct horse battery staple");

        Assert.StartsWith("pbkdf2-sha256$", a);
        Assert.NotEqual(a, b); // random salt
    }

    [Fact]
    public void Verify_AcceptsCorrectPassword_AndRejectsWrong()
    {
        var hash = _service.Hash("hunter2hunter2");

        Assert.True(_service.Verify("hunter2hunter2", hash));
        Assert.False(_service.Verify("hunter2hunter3", hash));
    }

    [Fact]
    public void Verify_RejectsMalformedStoredHashes_WithoutThrowing()
    {
        Assert.False(_service.Verify("x", ""));
        Assert.False(_service.Verify("x", "not-a-hash"));
        Assert.False(_service.Verify("x", "bcrypt$10$abc$def"));
        Assert.False(_service.Verify("x", "pbkdf2-sha256$abc$!!!$!!!"));
    }

    [Fact]
    public void Verify_AcceptsHashFromDifferentIterationCount()
    {
        // Older rows keep verifying because the count travels in the string.
        var legacy = "pbkdf2-sha256$100000$" + Convert.ToBase64String(new byte[16]) + "$" +
                     Convert.ToBase64String(System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(
                         "old-pass", new byte[16], 100000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32));
        Assert.True(_service.Verify("old-pass", legacy));
    }
}

public class EmailHashServiceTests
{
    private static EmailHashService ServiceWithKey(string? key = "test-key") =>
        new(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Auth:EmailHashKey"] = key }).Build());

    [Fact]
    public void Hash_IsDeterministic_AndCaseInsensitive()
    {
        var service = ServiceWithKey();
        Assert.Equal(service.Hash("Player@example.com"), service.Hash("player@example.com "));
        Assert.Equal(service.Hash("a@b.c"), service.Hash("a@b.c"));
    }

    [Fact]
    public void Matches_IsTrueForSameEmail_AndFalseForAnother()
    {
        var service = ServiceWithKey();
        var stored = service.Hash("someone@example.com");

        Assert.True(service.Matches("Someone@Example.com", stored));
        Assert.False(service.Matches("other@example.com", stored));
    }

    [Fact]
    public void IsHashedEmail_DistinguishesHashesFromAddresses()
    {
        var service = ServiceWithKey();
        Assert.True(service.IsHashedEmail(service.Hash("x@y.z")));
        Assert.False(service.IsHashedEmail("real@example.com"));
        Assert.False(service.IsHashedEmail(null));
    }

    [Fact]
    public void Hashes_AreKeyed_TwoKeysGiveDifferentDigests()
    {
        var one = ServiceWithKey("key-one").Hash("a@b.c");
        var two = ServiceWithKey("key-two").Hash("a@b.c");
        Assert.NotEqual(one, two);
    }

    [Fact]
    public void MissingKey_FallsBackToUnkeyedSha256_AndStillWorks()
    {
        // Fresh dev machines have no key; the seam must not throw there.
        var service = ServiceWithKey(null);
        var stored = service.Hash("dev@example.com");
        Assert.True(service.Matches("DEV@example.com", stored));
    }
}