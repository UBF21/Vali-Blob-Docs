---
title: Validation Middleware
sidebar_label: Validation
---

# Validation Middleware

`ValidationMiddleware` is the first line of defense in the pipeline. It inspects every upload request and rejects files that violate configured rules — before any processing (compression, encryption, virus scan) occurs. Rejected uploads return `StorageResult.Failure` with `StorageErrorCode.ValidationFailed` and a descriptive error message.

---

## Registration

```csharp
.WithPipeline(p => p
    .UseValidation(v =>
    {
        v.MaxFileSizeBytes     = 50_000_000;        // 50 MB
        v.MinFileSizeBytes     = 1;                 // reject empty files
        v.MaxFileNameLength    = 255;
        v.AllowedExtensions    = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"];
        v.AllowedContentTypes  = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
        v.BlockedExtensions    = [".exe", ".bat", ".sh", ".php"];
    })
    // other middlewares ...
)
```

---

## ValidationOptions Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `MaxFileSizeBytes` | `long?` | `null` (unlimited) | Maximum allowed file size in bytes |
| `MinFileSizeBytes` | `long?` | `null` (no minimum) | Minimum allowed file size in bytes; use `1` to reject zero-byte files |
| `MaxFileNameLength` | `int?` | `null` (unlimited) | Maximum number of characters in the filename portion of the path |
| `AllowedExtensions` | `string[]?` | `null` (all allowed) | Case-insensitive allow-list of extensions including the dot (`.jpg`) |
| `BlockedExtensions` | `string[]?` | `null` (none blocked) | Extensions that are always rejected; evaluated even when `AllowedExtensions` is set |
| `AllowedContentTypes` | `string[]?` | `null` (all allowed) | MIME type allow-list |
| `BlockedContentTypes` | `string[]?` | `null` (none blocked) | MIME types that are always rejected |
| `CustomValidators` | `IFileValidator[]` | `[]` | Additional custom rule implementations |

### Precedence rules

1. `BlockedExtensions` is checked first. If matched, the file is rejected immediately.
2. `AllowedExtensions` is checked next. If set and the extension is not in the list, the file is rejected.
3. `BlockedContentTypes` is checked. If matched, the file is rejected.
4. `AllowedContentTypes` is checked. If set and the content-type is not in the list, the file is rejected.
5. Size limits are checked.
6. Filename length is checked.
7. Custom validators run in order.

---

## Common Configurations

### Block all executable and script types

```csharp
.UseValidation(v =>
{
    v.BlockedExtensions = [
        ".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs",
        ".js", ".msi", ".dll", ".com", ".scr",
        ".php", ".py", ".rb", ".pl", ".cgi"
    ];
    v.BlockedContentTypes = [
        "application/x-msdownload",
        "application/x-executable",
        "application/x-sh",
        "text/x-shellscript",
        "application/javascript",
        "text/javascript"
    ];
})
```

### Images-only endpoint

```csharp
.UseValidation(v =>
{
    v.MaxFileSizeBytes    = 10_000_000;  // 10 MB
    v.AllowedExtensions   = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic"];
    v.AllowedContentTypes = [
        "image/jpeg", "image/png", "image/gif",
        "image/webp", "image/avif", "image/heic"
    ];
})
```

### Document upload endpoint

```csharp
.UseValidation(v =>
{
    v.MaxFileSizeBytes  = 100_000_000;  // 100 MB
    v.AllowedExtensions = [
        ".pdf", ".docx", ".doc", ".xlsx", ".xls",
        ".pptx", ".ppt", ".odt", ".ods", ".odp",
        ".txt", ".csv", ".rtf"
    ];
})
```

### Video upload with size limit

```csharp
.UseValidation(v =>
{
    v.MaxFileSizeBytes    = 2L * 1024 * 1024 * 1024;  // 2 GB
    v.AllowedExtensions   = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
    v.AllowedContentTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
})
```

### General-purpose upload with blocked types

```csharp
.UseValidation(v =>
{
    v.MaxFileSizeBytes   = 500_000_000;  // 500 MB
    v.BlockedExtensions  = [".exe", ".bat", ".sh", ".cmd", ".php", ".msi"];
    v.MinFileSizeBytes   = 1;            // no empty files
    v.MaxFileNameLength  = 200;
})
```

---

## Custom Validators

Implement `IFileValidator` for rules that cannot be expressed through the built-in options:

```csharp
public interface IFileValidator
{
    Task<ValidationResult> ValidateAsync(
        UploadRequest request,
        CancellationToken ct = default);
}

public record ValidationResult(bool IsValid, string? ErrorMessage = null)
{
    public static ValidationResult Ok()               => new(true);
    public static ValidationResult Fail(string msg)   => new(false, msg);
}
```

### Example: Reject PDFs with automatic actions (macro-like behavior)

```csharp
public class NoPdfWithAutoActionsValidator : IFileValidator
{
    public async Task<ValidationResult> ValidateAsync(UploadRequest request, CancellationToken ct)
    {
        if (request.ContentType != "application/pdf")
            return ValidationResult.Ok();

        // Read the first 1024 bytes to detect PDF auto-action markers
        var buffer = new byte[1024];
        var read   = await request.Content.ReadAsync(buffer, 0, buffer.Length, ct);

        // Reset the stream so downstream middleware receives the full file
        if (request.Content.CanSeek)
            request.Content.Position = 0;

        var header = System.Text.Encoding.ASCII.GetString(buffer, 0, read);

        if (header.Contains("/AA") || header.Contains("/OpenAction"))
            return ValidationResult.Fail(
                "PDF files with automatic actions are not permitted for security reasons.");

        return ValidationResult.Ok();
    }
}
```

### Example: Enforce a naming convention

```csharp
public class FileNamePatternValidator : IFileValidator
{
    private readonly Regex _pattern;

    public FileNamePatternValidator()
    {
        // Allow only alphanumeric, hyphens, underscores, and dots
        _pattern = new Regex(@"^[a-z0-9\-_\.]+$",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);
    }

    public Task<ValidationResult> ValidateAsync(UploadRequest request, CancellationToken ct)
    {
        var fileName = Path.GetFileName(request.Path.Value);

        return Task.FromResult(
            _pattern.IsMatch(fileName)
                ? ValidationResult.Ok()
                : ValidationResult.Fail(
                    $"Filename '{fileName}' contains invalid characters. " +
                    "Only letters, numbers, hyphens, underscores, and dots are allowed.")
        );
    }
}
```

### Example: Per-user quota as a custom validator

```csharp
public class UserQuotaValidator : IFileValidator
{
    private readonly IUserStorageRepository _repo;
    private readonly IHttpContextAccessor   _http;
    private const long PerUserLimitBytes = 5L * 1024 * 1024 * 1024; // 5 GB

    public UserQuotaValidator(
        IUserStorageRepository repo,
        IHttpContextAccessor http)
    {
        _repo = repo;
        _http = http;
    }

    public async Task<ValidationResult> ValidateAsync(UploadRequest request, CancellationToken ct)
    {
        var userId = _http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null)
            return ValidationResult.Fail("Request is not authenticated.");

        var usedBytes = await _repo.GetUsedBytesAsync(userId, ct);
        var fileSize  = request.ContentLength ?? 0;

        if (usedBytes + fileSize > PerUserLimitBytes)
            return ValidationResult.Fail(
                $"Your storage quota is full. " +
                $"Used: {usedBytes / 1024 / 1024:N0} MB / " +
                $"{PerUserLimitBytes / 1024 / 1024:N0} MB.");

        return ValidationResult.Ok();
    }
}
```

### Registering custom validators

```csharp
// Register validators in DI
builder.Services.AddScoped<NoPdfWithAutoActionsValidator>();
builder.Services.AddScoped<FileNamePatternValidator>();
builder.Services.AddScoped<UserQuotaValidator>();

// Add to pipeline (requires IServiceProvider access)
var sp = builder.Services.BuildServiceProvider(); // or use factory pattern

.WithPipeline(p => p
    .UseValidation(v =>
    {
        v.MaxFileSizeBytes  = 100_000_000;
        v.AllowedExtensions = [".pdf", ".jpg", ".png"];
        v.CustomValidators  =
        [
            sp.GetRequiredService<NoPdfWithAutoActionsValidator>(),
            sp.GetRequiredService<FileNamePatternValidator>(),
            sp.GetRequiredService<UserQuotaValidator>()
        ];
    })
)
```

---

## Validation Failure Responses

When validation fails, `UploadAsync` returns a result with `ErrorCode = StorageErrorCode.ValidationFailed`:

```csharp
var result = await provider.UploadAsync(request);

// result.IsSuccess    == false
// result.ErrorCode    == StorageErrorCode.ValidationFailed
// result.ErrorMessage == "File size 150,000,000 bytes exceeds the maximum allowed size of 50,000,000 bytes."

if (result.ErrorCode == StorageErrorCode.ValidationFailed)
    return Results.BadRequest(new { error = result.ErrorMessage });
```

Example error messages:

| Rule violated | Example error message |
|---|---|
| File too large | `"File size 150000000 bytes exceeds maximum allowed size of 50000000 bytes."` |
| Extension not allowed | `"File extension '.exe' is not in the list of allowed extensions: .jpg, .png, .pdf"` |
| Extension blocked | `"File extension '.bat' is blocked and cannot be uploaded."` |
| Content type not allowed | `"Content type 'application/x-executable' is not permitted."` |
| Empty file | `"File size 0 bytes is below the minimum allowed size of 1 byte."` |
| Custom validator | Whatever your `ValidationResult.Fail(message)` returns |

---

## Extension Check vs Content-Type Check

These two checks are complementary, not equivalent:

| Check | How it works | Weakness |
|---|---|---|
| Extension check | Looks at the last segment of the filename after the last `.` | A user can rename `virus.exe` to `document.pdf` |
| Content-type check | Looks at the `Content-Type` header the client provides | A client can send any header value |
| Magic bytes detection | Reads the first N bytes and identifies the real format | Possible to craft files that fool detection |

For maximum security, combine all three approaches:

```csharp
.WithPipeline(p => p
    .UseContentTypeDetection(o => o.OverrideExisting = true)  // detect from magic bytes FIRST
    .UseValidation(v =>
    {
        // Now AllowedContentTypes checks the REAL detected type, not the client header
        v.AllowedExtensions   = [".jpg", ".png", ".pdf"];
        v.AllowedContentTypes = ["image/jpeg", "image/png", "application/pdf"];
        v.BlockedExtensions   = [".exe", ".bat", ".sh"];
    })
    .UseVirusScan()  // scan the actual content for malware
)
```

:::tip Place ContentTypeDetection before Validation for strongest security
With `OverrideExisting = true`, content-type detection runs first and sets `ContentType` from the actual file magic bytes. Then validation's `AllowedContentTypes` check operates on the real detected type. A user renaming `virus.exe` to `document.pdf` will be correctly detected as `application/x-msdownload` and rejected.
:::

---

## Related

- [Content-Type Detection](./content-type-detection.md) — Detect MIME from magic bytes to strengthen content-type validation
- [Virus Scan](./virus-scan.md) — Detect malware after validation passes
- [Pipeline Overview](./overview.md) — Middleware ordering and execution
- [StorageResult](../core/storage-result.md) — Handling `StorageErrorCode.ValidationFailed`
