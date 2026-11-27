namespace api.Auth.Models;

/// <summary>One outbound email: a plain-text body always rides with the HTML one.</summary>
public record EmailMessage(string To, string Subject, string Html, string Text);
