---
id: quick-start
title: Quick Start
sidebar_label: Quick Start
---

# Quick Start

This guide walks you through installing ValiBlob, wiring up the AWS S3 provider in an ASP.NET Core application, uploading a file, downloading it, and handling errors — from zero to working in under five minutes.

---

## 1. Install Packages

Install `ValiBlob.Core` and the provider package for your target backend. For AWS S3:

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.AWS
```

For Azure Blob Storage instead:

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Azure
```

For local development without any cloud account:

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Local
```

:::tip Start local
If you are exploring ValiBlob for the first time, use `ValiBlob.Local`. It requires no credentials, no cloud account, and stores files on your disk. The rest of this guide uses AWS S3 but you can swap to any provider with a one-line change.
:::

---

## 2. Configure Dependency Injection

In `Program.cs`, register ValiBlob with the AWS S3 provider and a basic pipeline:

```csharp
using ValiBlob.Core;
using ValiBlob.AWS;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(options =>
    {
        options.DefaultProvider = "aws";
    })
    .AddProvider<AWSS3Provider>("aws", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region     = builder.Configuration["AWS:Region"]!;
        opts.AccessKey  = builder.Configuration["AWS:AccessKey"]!;
        opts.SecretKey  = builder.Configuration["AWS:SecretKey"]!;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes  = 50_000_000; // 50 MB
            v.AllowedExtensions = [".jpg", ".png", ".pdf", ".docx"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );

var app = builder.Build();
```

Add the required values to `appsettings.Development.json`:

```json
{
  "AWS": {
    "BucketName": "my-app-dev-bucket",
    "Region": "us-east-1",
    "AccessKey": "AKIAIOSFODNN7EXAMPLE",
    "SecretKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  }
}
```

:::warning Never commit real credentials
Use `dotnet user-secrets` for development credentials:

```bash
dotnet user-secrets set "AWS:AccessKey" "AKIAIOSFODNN7EXAMPLE"
dotnet user-secrets set "AWS:SecretKey" "wJalrXUtnFEMI/..."
```

In production, use IAM instance roles or environment variables — not hardcoded values.
:::

---

## 3. Upload a File

### Minimal API Endpoint

```csharp
app.MapPost("/files/upload", async (
    IFormFile file,
    IStorageFactory factory) =>
{
    var provider = factory.Create(); // uses DefaultProvider ("aws")

    await using var stream = file.OpenReadStream();

    var request = new UploadRequest
    {
        Path          = StoragePath.From("uploads", StoragePath.Sanitize(file.FileName)),
        Content       = stream,
        ContentType   = file.ContentType,
        ContentLength = file.Length,
        Metadata      = new Dictionary<string, string>
        {
            ["uploaded-by"]  = "quick-start-example",
            ["original-name"] = file.FileName
        }
    };

    var result = await provider.UploadAsync(request);

    return result.IsSuccess
        ? Results.Ok(new { url = result.Value.Url, path = result.Value.Path })
        : Results.Problem(result.ErrorMessage, statusCode: 500);
})
.DisableAntiforgery();
```

### Controller-Based Endpoint

```csharp
[ApiController]
[Route("api/[controller]")]
public class FilesController(IStorageFactory factory) : ControllerBase
{
    [HttpPost("upload")]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> Upload(IFormFile file, CancellationToken ct)
    {
        var provider = factory.Create();

        await using var stream = file.OpenReadStream();

        var result = await provider.UploadAsync(new UploadRequest
        {
            Path          = StoragePath.From("uploads", StoragePath.Sanitize(file.FileName)),
            Content       = stream,
            ContentType   = file.ContentType,
            ContentLength = file.Length
        }, ct);

        if (!result.IsSuccess)
        {
            return result.ErrorCode switch
            {
                StorageErrorCode.ValidationFailed => BadRequest(result.ErrorMessage),
                StorageErrorCode.QuotaExceeded    => StatusCode(507, result.ErrorMessage),
                _                                 => StatusCode(500, result.ErrorMessage)
            };
        }

        return Ok(new
        {
            url  = result.Value.Url,
            path = result.Value.Path,
            size = result.Value.SizeBytes
        });
    }
}
```

:::info StoragePath.Sanitize
Always sanitize filenames supplied by users. `StoragePath.Sanitize` lowercases the name, replaces spaces and special characters with hyphens, and removes unsafe characters. Without this, a user could supply a filename like `../../etc/passwd` and potentially affect your storage structure.
:::

---

## 4. Download a File and Stream to Response

Streaming the file directly to the HTTP response without buffering it in memory:

```csharp
app.MapGet("/files/{*path}", async (
    string path,
    IStorageFactory factory,
    HttpContext ctx) =>
{
    var provider = factory.Create();

    var result = await provider.DownloadAsync(new DownloadRequest
    {
        Path = path
    });

    if (!result.IsSuccess)
    {
        return result.ErrorCode == StorageErrorCode.FileNotFound
            ? Results.NotFound($"No file found at path: {path}")
            : Results.Problem(result.ErrorMessage);
    }

    // Stream directly to the HTTP response. ValiBlob handles
    // transparent decompression and decryption if those middlewares
    // were used on upload.
    var metaResult = await provider.GetMetadataAsync(path);
    var contentType = metaResult.IsSuccess
        ? metaResult.Value.ContentType
        : "application/octet-stream";

    return Results.Stream(result.Value, contentType: contentType);
});
```

For a controller endpoint with proper content-type and disposition headers:

```csharp
[HttpGet("{*path}")]
public async Task<IActionResult> Download(string path, CancellationToken ct)
{
    var provider = _factory.Create();

    var downloadResult = await provider.DownloadAsync(
        new DownloadRequest { Path = path }, ct);

    if (!downloadResult.IsSuccess)
    {
        return downloadResult.ErrorCode == StorageErrorCode.FileNotFound
            ? NotFound()
            : StatusCode(500, downloadResult.ErrorMessage);
    }

    var metaResult = await provider.GetMetadataAsync(path, ct);
    var contentType = metaResult.IsSuccess
        ? metaResult.Value.ContentType
        : "application/octet-stream";

    var fileName = Path.GetFileName(path);
    Response.Headers.ContentDisposition = $"attachment; filename=\"{fileName}\"";

    return File(downloadResult.Value, contentType, enableRangeProcessing: false);
}
```

---

## 5. Handle Errors with StorageResult

ValiBlob uses the `StorageResult<T>` pattern — no exceptions are thrown for expected failure conditions. The `ErrorCode` property tells you exactly what went wrong:

```csharp
var result = await provider.UploadAsync(request);

if (result.IsSuccess)
{
    Console.WriteLine($"Uploaded to: {result.Value.Url}");
    Console.WriteLine($"Size: {result.Value.SizeBytes:N0} bytes");
    return;
}

// Handle each failure case explicitly
var response = result.ErrorCode switch
{
    StorageErrorCode.ValidationFailed =>
        Results.BadRequest($"File rejected: {result.ErrorMessage}"),

    StorageErrorCode.QuotaExceeded =>
        Results.StatusCode(507), // 507 Insufficient Storage

    StorageErrorCode.VirusScanFailed =>
        Results.UnprocessableEntity($"Threat detected: {result.ErrorMessage}"),

    StorageErrorCode.AccessDenied =>
        Results.StatusCode(403),

    StorageErrorCode.Conflict =>
        Results.Conflict("A file already exists at this path."),

    StorageErrorCode.Duplicate =>
        Results.Ok(new { duplicate = true, message = result.ErrorMessage }),

    _ =>
        Results.Problem(result.ErrorMessage, statusCode: 500)
};
```

All error codes are documented in [StorageResult](./core/storage-result.md).

---

## 6. Check File Existence and Delete

```csharp
// Check whether a file exists before downloading
var exists = await provider.ExistsAsync("uploads/avatar.jpg");

if (exists.IsSuccess && exists.Value)
{
    Console.WriteLine("File exists.");
}

// Delete a single file
var deleteResult = await provider.DeleteAsync("uploads/old-avatar.jpg");

if (!deleteResult.IsSuccess)
    Console.WriteLine($"Delete failed: {deleteResult.ErrorMessage}");

// Delete a folder (all objects under a prefix)
var folderDeleteResult = await provider.DeleteFolderAsync("uploads/user-123/");

if (folderDeleteResult.IsSuccess)
    Console.WriteLine("All files for user-123 deleted.");
```

---

## Complete Minimal API Example

The following is a self-contained `Program.cs` showing all common operations:

```csharp
using ValiBlob.Core;
using ValiBlob.AWS;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", o =>
    {
        o.BucketName = builder.Configuration["AWS:BucketName"]!;
        o.Region     = builder.Configuration["AWS:Region"]!;
        o.AccessKey  = builder.Configuration["AWS:AccessKey"]!;
        o.SecretKey  = builder.Configuration["AWS:SecretKey"]!;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes  = 100_000_000;
            v.AllowedExtensions = [".jpg", ".png", ".pdf"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );

var app = builder.Build();

// Upload
app.MapPost("/upload", async (IFormFile file, IStorageFactory factory) =>
{
    var provider = factory.Create();
    await using var stream = file.OpenReadStream();

    var result = await provider.UploadAsync(new UploadRequest
    {
        Path          = StoragePath.From("uploads", StoragePath.Sanitize(file.FileName)),
        Content       = stream,
        ContentType   = file.ContentType,
        ContentLength = file.Length
    });

    return result.IsSuccess
        ? Results.Ok(new { result.Value.Url, result.Value.Path })
        : Results.Problem(result.ErrorMessage);
}).DisableAntiforgery();

// Download
app.MapGet("/download/{*path}", async (string path, IStorageFactory factory) =>
{
    var result = await factory.Create().DownloadAsync(new DownloadRequest { Path = path });

    return result.IsSuccess
        ? Results.Stream(result.Value, contentType: "application/octet-stream")
        : Results.NotFound();
});

// Check existence
app.MapGet("/exists/{*path}", async (string path, IStorageFactory factory) =>
{
    var result = await factory.Create().ExistsAsync(path);
    return result.IsSuccess
        ? Results.Ok(new { exists = result.Value })
        : Results.Problem(result.ErrorMessage);
});

// Delete
app.MapDelete("/delete/{*path}", async (string path, IStorageFactory factory) =>
{
    var result = await factory.Create().DeleteAsync(path);
    return result.IsSuccess ? Results.NoContent() : Results.Problem(result.ErrorMessage);
});

// List files under a prefix
app.MapGet("/list/{*prefix}", async (string prefix, IStorageFactory factory) =>
{
    var result = await factory.Create().ListFilesAsync(prefix);
    return result.IsSuccess
        ? Results.Ok(result.Value.Select(f => new { f.Path, f.SizeBytes, f.ContentType }))
        : Results.Problem(result.ErrorMessage);
});

app.Run();
```

---

## Next Steps

Now that you have a working upload and download, explore the rest of ValiBlob:

| Topic | What you'll learn |
|---|---|
| [StorageResult](./core/storage-result.md) | All error codes, chaining patterns, and the result type in depth |
| [StoragePath](./core/storage-path.md) | Date prefixes, hash suffixes, random suffixes, and sanitization |
| [Upload](./core/upload.md) | `UploadRequest` and `UploadResult` fields, multi-file uploads |
| [Download](./core/download.md) | Range downloads, streaming, auto-decryption |
| [Pipeline Overview](./pipeline/overview.md) | Add encryption, compression, virus scanning, and more |
| [Validation](./pipeline/validation.md) | File size limits, extension allow-lists, custom validators |
| [Encryption](./pipeline/encryption.md) | AES-256-CBC at the application layer |
| [Resumable Uploads](./resumable/overview.md) | Handle large file uploads reliably |
