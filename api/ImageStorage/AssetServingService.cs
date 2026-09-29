using Microsoft.Extensions.Logging;
using System.Buffers.Binary;
using System.Text;

namespace api.ImageStorage;

public interface IAssetServingService
{
    /// <summary>
    /// Serves a file from the specified base path with strict security validation.
    /// With <paramref name="acceptGzip"/>, a glb that has a matching <c>.glb.gz</c> beside it
    /// is served from that, and the result carries its Content-Encoding.
    /// </summary>
    Task<AssetResult> GetAssetAsync(string basePath, string relativePath, bool acceptGzip = false);
}

/// <summary>
/// Hardened asset serving service with comprehensive path traversal protection
/// </summary>
public class AssetServingService(ILogger<AssetServingService> logger) : IAssetServingService
{
    // Maximum file size: level scenes (Tobruk-scale) land well above 100MB.
    private const long MaxFileSizeBytes = 512 * 1024 * 1024;

    // Whitelist of allowed file extensions (security by explicit allowance)
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp",
        ".pdf", ".zip", ".txt", ".json",
        ".glb", ".gltf", ".bin",
    };

    // Files the mesh pipeline writes a gzip copy of (features/mesh-asset-size, phase 2a).
    private static readonly HashSet<string> PrecompressedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".glb",
    };

    public async Task<AssetResult> GetAssetAsync(string basePath, string relativePath, bool acceptGzip = false)
    {
        try
        {
            // 1. VALIDATION: Input sanitization and null/whitespace checks
            if (string.IsNullOrWhiteSpace(relativePath))
            {
                logger.LogWarning("Attempted access with empty path");
                return AssetResult.BadRequest("Invalid file path");
            }

            // 2. SECURITY: Normalize unicode to prevent canonicalization bypasses
            string normalizedPath = relativePath.Normalize(NormalizationForm.FormC);

            // 3. SECURITY: Comprehensive path traversal prevention
            if (!ValidatePath(normalizedPath))
            {
                logger.LogWarning("Path validation failed for: {Path}", normalizedPath);
                return AssetResult.BadRequest("Invalid file path");
            }

            // 4. SECURITY: Normalize and canonicalize both paths
            string normalizedBasePath = Path.GetFullPath(basePath).Normalize(NormalizationForm.FormC);
            string combinedPath = Path.Combine(normalizedBasePath, normalizedPath);
            string fullPath = Path.GetFullPath(combinedPath).Normalize(NormalizationForm.FormC);

            // 5. SECURITY: Verify resolved path is within base directory using case-sensitive comparison on Linux
            if (!IsPathWithinBase(fullPath, normalizedBasePath))
            {
                logger.LogWarning("Path traversal attempt detected. Requested: {Path}, Resolved: {FullPath}", normalizedPath, fullPath);
                return AssetResult.Forbidden();
            }

            // 6. SECURITY: Check for symlinks that could escape the base directory
            if (ContainsSymlink(fullPath, normalizedBasePath))
            {
                logger.LogWarning("Symlink traversal attempt detected: {Path}", fullPath);
                return AssetResult.Forbidden();
            }

            // 7. Check if file exists
            if (!System.IO.File.Exists(fullPath))
            {
                logger.LogInformation("Asset not found: {Path}", normalizedPath);
                return AssetResult.NotFound();
            }

            // 8. SECURITY: Validate file extension is in whitelist
            var fileInfo = new FileInfo(fullPath);
            if (!AllowedExtensions.Contains(fileInfo.Extension))
            {
                logger.LogWarning("File extension not allowed: {Extension} for path {Path}", fileInfo.Extension, normalizedPath);
                return AssetResult.BadRequest("File type not allowed");
            }

            // 9. SECURITY: Check file size to prevent DOS
            if (fileInfo.Length > MaxFileSizeBytes)
            {
                logger.LogWarning("File exceeds maximum size: {Size} bytes for {Path}", fileInfo.Length, normalizedPath);
                return AssetResult.BadRequest("File too large");
            }

            // 10. Get content type
            var contentType = GetContentType(fileInfo.Extension);

            // 11. The pre-compressed copy, when the client takes gzip and the copy is of this file
            if (acceptGzip && MatchingGzip(fileInfo, normalizedBasePath, contentType) is { } gzipped)
                return gzipped;

            var fileStream = System.IO.File.OpenRead(fullPath);

            return AssetResult.Success(fileStream, contentType, fileInfo.Name);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving asset {Path}", relativePath);
            return AssetResult.ServerError();
        }
    }

    /// <summary>
    /// Serves <c>&lt;file&gt;.gz</c> if it is a gzip of <paramref name="plain"/>, or returns null
    /// and the plain file is served. The publisher never lands a mismatched pair; this guards a
    /// file copied onto the volume some other way, cheaply: the gzip trailer's length must be
    /// the file's, and the copy must be at least as new (the pipeline writes it second). A
    /// same-length edit made after the copy fails the second test. Either miss falls back to
    /// the plain file, which is always right.
    /// </summary>
    private static AssetResult? MatchingGzip(FileInfo plain, string basePath, string contentType)
    {
        if (!PrecompressedExtensions.Contains(plain.Extension))
            return null;

        var gzip = new FileInfo(plain.FullName + ".gz");
        if (!gzip.Exists || gzip.Length < 18 || gzip.LastWriteTimeUtc < plain.LastWriteTimeUtc
            || ContainsSymlink(gzip.FullName, basePath))
            return null;

        var stream = System.IO.File.OpenRead(gzip.FullName);
        try
        {
            Span<byte> head = stackalloc byte[2];
            stream.ReadExactly(head);
            Span<byte> length = stackalloc byte[4];
            stream.Seek(-4, SeekOrigin.End);
            stream.ReadExactly(length);
            if (head[0] == 0x1f && head[1] == 0x8b
                && BinaryPrimitives.ReadUInt32LittleEndian(length) == unchecked((uint)plain.Length))
            {
                stream.Seek(0, SeekOrigin.Begin);
                return AssetResult.Gzip(stream, contentType, plain.Name, plain.Length);
            }
        }
        catch (IOException)
        {
        }

        stream.Dispose();
        return null;
    }

    /// <summary>
    /// Validates path against directory traversal vectors
    /// Uses whitelist approach: only allow alphanumeric, dash, underscore, dot, and forward slash
    /// </summary>
    private static bool ValidatePath(string path)
    {
        // Check for null bytes
        if (path.Contains('\0'))
            return false;

        // Check for absolute paths
        if (path.StartsWith('/') || path.StartsWith('\\'))
            return false;

        // Check for various directory traversal patterns
        if (path.Contains("..") || path.Contains("./") || path.Contains(".\\"))
            return false;

        // Check for drive letters (Windows)
        if (path.Length > 1 && path[1] == ':')
            return false;

        // Check for UNC paths (Windows)
        if (path.StartsWith("\\\\"))
            return false;

        // Check for trailing dots or spaces (Windows alternative data streams and file name tricks)
        if (path.EndsWith('.') || path.EndsWith(' '))
            return false;

        // Whitelist approach: only allow safe characters
        // Letters, digits, dots, dashes, underscores, and forward slashes
        foreach (char c in path)
        {
            if (!char.IsLetterOrDigit(c) && c != '.' && c != '-' && c != '_' && c != '/')
                return false;
        }

        return true;
    }

    /// <summary>
    /// Ensures resolved path is within the base directory
    /// Uses case-sensitive comparison on Linux, case-insensitive on Windows
    /// </summary>
    private static bool IsPathWithinBase(string fullPath, string basePath)
    {
        // Use OS-specific comparison based on filesystem case sensitivity
        StringComparison comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        // Ensure both paths have trailing separators for proper comparison
        string baseWithSeparator = basePath.EndsWith(Path.DirectorySeparatorChar)
            ? basePath
            : basePath + Path.DirectorySeparatorChar;

        return fullPath.StartsWith(baseWithSeparator, comparison) ||
               fullPath.Equals(basePath, comparison);
    }

    /// <summary>
    /// Checks if the path contains symlinks that could escape the base directory
    /// </summary>
    private static bool ContainsSymlink(string fullPath, string basePath)
    {
        try
        {
            // Only perform symlink check on systems that support it
            if (!OperatingSystem.IsWindows())
            {
                var fileInfo = new FileInfo(fullPath);
                var directoryInfo = new DirectoryInfo(fullPath);

                // Check if the target file is a symlink
                if (fileInfo.Exists && fileInfo.LinkTarget != null)
                {
                    var targetPath = Path.GetFullPath(fileInfo.LinkTarget).Normalize(NormalizationForm.FormC);
                    if (!targetPath.StartsWith(basePath, StringComparison.Ordinal))
                        return true;
                }

                // Check all parent directories for symlinks
                var currentDir = new DirectoryInfo(fullPath).Parent;
                while (currentDir != null && currentDir.FullName.StartsWith(basePath, StringComparison.Ordinal))
                {
                    if (currentDir.LinkTarget != null)
                        return true;
                    currentDir = currentDir.Parent;
                }
            }

            return false;
        }
        catch
        {
            // If we can't check symlinks, deny access as a safety measure
            return true;
        }
    }

    /// <summary>
    /// Maps file extension to MIME type with security considerations
    /// SVG and PDF are excluded from automatic serving to prevent XSS
    /// </summary>
    private static string GetContentType(string extension)
    {
        return extension.ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".pdf" => "application/pdf",
            ".zip" => "application/zip",
            ".txt" => "text/plain; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".glb" => "model/gltf-binary",
            ".gltf" => "model/gltf+json",
            ".bin" => "application/octet-stream",
            _ => "application/octet-stream"
        };
    }
}

public class AssetResult
{
    public bool IsSuccess { get; private set; }
    public int StatusCode { get; private set; }
    public string? ErrorMessage { get; private set; }
    public Stream? FileStream { get; private set; }
    public string? ContentType { get; private set; }
    public string? FileName { get; private set; }

    /// <summary>"gzip" when <see cref="FileStream"/> is the pre-compressed copy, else null.</summary>
    public string? ContentEncoding { get; private set; }

    /// <summary>The size of the file the stream inflates to, when it is compressed.</summary>
    public long? UncompressedLength { get; private set; }

    public static AssetResult Success(Stream fileStream, string contentType, string fileName)
        => new() { IsSuccess = true, StatusCode = 200, FileStream = fileStream, ContentType = contentType, FileName = fileName };

    public static AssetResult Gzip(Stream fileStream, string contentType, string fileName, long uncompressedLength)
        => new()
        {
            IsSuccess = true, StatusCode = 200, FileStream = fileStream, ContentType = contentType, FileName = fileName,
            ContentEncoding = "gzip", UncompressedLength = uncompressedLength,
        };

    public static AssetResult BadRequest(string message)
        => new() { IsSuccess = false, StatusCode = 400, ErrorMessage = message };

    public static AssetResult NotFound()
        => new() { IsSuccess = false, StatusCode = 404, ErrorMessage = "Asset not found" };

    public static AssetResult Forbidden()
        => new() { IsSuccess = false, StatusCode = 403, ErrorMessage = "Access denied" };

    public static AssetResult ServerError()
        => new() { IsSuccess = false, StatusCode = 500, ErrorMessage = "Error retrieving asset" };
}
