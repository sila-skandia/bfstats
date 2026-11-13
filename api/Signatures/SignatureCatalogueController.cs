using api.Signatures.Models;
using Microsoft.AspNetCore.Mvc;

namespace api.Signatures;

/// <summary>What the signature builders offer: each mod with art, and its scenes.</summary>
[ApiController]
[Route("stats/signatures")]
public class SignatureCatalogueController(SignatureArtCatalogue art) : ControllerBase
{
    [HttpGet("catalogue")]
    public ActionResult<SignatureCatalogueDto> Catalogue()
    {
        Response.Headers.CacheControl = "public, max-age=3600";
        return new SignatureCatalogueDto(art.Mods);
    }

    /// <summary>A scene's hero art on its own, for the builders' scene picker.</summary>
    [HttpGet("art/{modId}/{sceneId}.webp")]
    public IActionResult Hero(string modId, string sceneId)
    {
        var pick = art.Pick(modId, sceneId);
        if (pick is null
            || !pick.Mod.Id.Equals(modId, StringComparison.OrdinalIgnoreCase)
            || !pick.Scene.Id.Equals(sceneId, StringComparison.OrdinalIgnoreCase)
            || !System.IO.File.Exists(pick.HeroPath))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=86400";
        return PhysicalFile(pick.HeroPath, "image/webp");
    }
}
