namespace api.AppSignIn.Models;

/// <summary>The code, and the redirect URI it is bound to, for the page to send the browser back to.</summary>
public record AuthorizeAppResponse(string Code, string RedirectUri);
