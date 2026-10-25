namespace api.AppSignIn.Models;

/// <summary>Who the app is signed in as: the account id and the name to show for it.</summary>
public record AppTokenUser(int Id, string Username);
