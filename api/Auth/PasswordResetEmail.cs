using System.Net;
using api.Auth.Models;

namespace api.Auth;

/// <summary>
/// The reset email (features/password-reset): the logo, one line, one button,
/// the link again as text. Table layout and inline styles, because mail clients
/// strip stylesheets; the logo is a PNG on the site, since few clients draw webp.
/// </summary>
public static class PasswordResetEmail
{
    public const string Subject = "Reset your bfstats.io password";

    public static EmailMessage Build(string to, string username, string resetUrl, string siteBaseUrl, int minutesValid)
    {
        var name = WebUtility.HtmlEncode(username);
        var url = WebUtility.HtmlEncode(resetUrl);
        var logo = WebUtility.HtmlEncode($"{siteBaseUrl.TrimEnd('/')}/email/logo.png");

        var html = $"""
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{Subject}</title></head>
            <body style="margin:0;padding:0;background:#131313;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#131313;">
              <tr><td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1a1a1a;border:1px solid #2a2a2a;">
                  <tr><td style="padding:28px 28px 0 28px;">
                    <img src="{logo}" width="48" height="46" alt="bfstats.io" style="display:block;border:0;">
                  </td></tr>
                  <tr><td style="padding:20px 28px 0 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#e6e6e6;">
                    Someone asked to reset the password for <strong>{name}</strong> on bfstats.io.
                    The link works once, for {minutesValid} minutes.
                  </td></tr>
                  <tr><td style="padding:24px 28px 0 28px;">
                    <a href="{url}" style="display:inline-block;background:#7d8849;color:#000000;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 20px;">Choose a new password</a>
                  </td></tr>
                  <tr><td style="padding:24px 28px 28px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9a9a9a;">
                    Or paste this into your browser:<br>
                    <a href="{url}" style="color:#9aa666;word-break:break-all;">{url}</a><br><br>
                    If you did not ask for this, ignore this email. Your password stays as it is.
                  </td></tr>
                </table>
              </td></tr>
            </table>
            </body>
            </html>
            """;

        var text = $"""
            Someone asked to reset the password for {username} on bfstats.io.
            The link works once, for {minutesValid} minutes:

            {resetUrl}

            If you did not ask for this, ignore this email. Your password stays as it is.
            """;

        return new EmailMessage(to, Subject, html, text);
    }
}
