---
title: Local Filesystem Provider
sidebar_label: Local Filesystem
sidebar_position: 6
---

# Local Filesystem Provider

`ValiBlob.Local` provides `LocalStorageProvider`, implementing `IStorageProvider`, `IResumableUploadProvider`, and `IPresignedUrlProvider` backed by the local filesystem. It requires no external services and is the fastest path to getting started with ValiBlob.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Local
```

---

## LocalStorageOptions Reference

| Option | Type | Required | Description |
|---|---|---|---|
| `BasePath` | `string` | Yes | Absolute path to the root directory where files are stored. |
| `CreateIfNotExists` | `bool` | No | Create `BasePath` (and parent directories) on startup if missing. Default: `false`. |
| `PublicBaseUrl` | `string?` | No | Base URL prefix for URL generation. If `null`, returns `file://` URIs. |

---

## DI Registration

```csharp
using ValiBlob.Core;
using ValiBlob.Local;

var storagePath = Path.Combine(builder.Environment.ContentRootPath, "storage");

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "local")
    .AddProvider<LocalStorageProvider>("local", opts =>
    {
        opts.BasePath          = storagePath;
        opts.CreateIfNotExists = true;
        opts.PublicBaseUrl     = builder.Environment.IsDevelopment()
            ? "http://localhost:5000/files"
            : null;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes  = 50_000_000;
            v.AllowedExtensions = [".jpg", ".png", ".pdf", ".mp4"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );
```

---

## Directory Structure

When a file is uploaded to `"uploads/images/avatar.jpg"`, the provider creates:

```
storage/                          ← BasePath
  uploads/
    images/
      avatar.jpg                  ← the uploaded file
      avatar.jpg.meta.json        ← metadata sidecar file
```

Subdirectories are created automatically. The provider never writes files outside `BasePath`.

---

## Metadata Sidecar Files

Every uploaded file gets a companion `.meta.json` sidecar file in the same directory. This file persists metadata that the filesystem cannot natively store — content type, custom user metadata, upload timestamp, and ETag:

```json
{
  "contentType": "image/jpeg",
  "contentLength": 102400,
  "eTag": "d41d8cd98f00b204e9800998ecf8427e",
  "uploadedAt": "2026-03-18T10:30:00Z",
  "customMetadata": {
    "x-user-id": "42",
    "x-original-name": "profile-photo.jpg",
    "x-vali-compressed": "gzip",
    "x-vali-original-size": "310000"
  }
}
```

`GetMetadataAsync` reads from the sidecar without touching the binary file. `DeleteAsync` removes both the main file and its `.meta.json` sidecar atomically.

---

## Resumable Upload Storage

In-progress resumable uploads are stored in a hidden `.resumable/` subdirectory under `BasePath`:

```
storage/
  .resumable/
    abc123-upload-id/
      0.chunk               ← bytes 0–5,242,879
      5242880.chunk         ← bytes 5,242,880–10,485,759
      10485760.chunk        ← ...
  uploads/
    large-video.mp4         ← assembled after CompleteResumableUploadAsync
```

Each chunk file is named by its byte offset. On `CompleteResumableUploadAsync`, all chunks are concatenated in offset order into the final file, and the `.resumable/{uploadId}/` directory is deleted.

---

## URL Generation

### With PublicBaseUrl

```csharp
opts.PublicBaseUrl = "http://localhost:5000/files";
```

A file at `"uploads/images/avatar.jpg"` gets the URL:

```
http://localhost:5000/files/uploads/images/avatar.jpg
```

Suitable when you serve the storage directory via `app.UseStaticFiles()` or a reverse proxy.

### Without PublicBaseUrl

The provider returns a `file://` URI pointing to the absolute disk path:

```
file:///home/app/storage/uploads/images/avatar.jpg
```

Useful for server-side processing where public accessibility is not needed.

---

## Serving Files over HTTP

Map the storage directory as a static file endpoint:

```csharp
// Program.cs
var storagePath = Path.Combine(builder.Environment.ContentRootPath, "storage");

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(storagePath),
    RequestPath  = "/files"
});
```

Files become accessible at:

```
GET http://localhost:5000/files/uploads/images/avatar.jpg
```

### Hiding Sidecar Files

To prevent `.meta.json` sidecar files from being served publicly, add middleware before `UseStaticFiles`:

```csharp
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.Value?.EndsWith(".meta.json",
            StringComparison.OrdinalIgnoreCase) == true)
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(storagePath),
    RequestPath  = "/files"
});
```

---

## Presigned URLs (Token-Based)

`LocalStorageProvider` implements `IPresignedUrlProvider` using short-lived signed tokens. Tokens are signed with a server-side HMAC key and verified by a ValiBlob download endpoint registered in your application:

```csharp
// Register the token endpoint — handles GET /valiblob/download/{token}
app.MapValiBlob();

// Generate a presigned download URL
var provider = factory.Create("local");

if (provider is IPresignedUrlProvider presigned)
{
    var downloadUrl = await presigned.GetPresignedDownloadUrlAsync(
        "private/salary-report.pdf",
        expiresIn: TimeSpan.FromHours(1));

    // → http://localhost:5000/valiblob/download/eyJ...signedtoken
    return Results.Ok(new { url = downloadUrl.Value });
}
```

The `/valiblob/download/{token}` endpoint validates the token signature and expiry, then streams the file. No cloud infrastructure is required.

---

## Concurrent Access

The local provider handles concurrent writes safely:

- **Write operations** open `FileStream` with `FileShare.None` during the write — preventing partial reads by other threads.
- **Read operations** use `FileShare.Read` and can run concurrently.
- **Resumable upload chunks** are written to separate per-chunk files, so concurrent chunk uploads from different HTTP requests do not conflict.

For heavy concurrent workloads or multi-server deployments, switch to a cloud provider (AWS S3, Azure Blob, GCS).

---

## Complete Setup Example

```csharp
// Program.cs
using ValiBlob.Core;
using ValiBlob.Local;

var storagePath = Path.Combine(builder.Environment.ContentRootPath, "storage");

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "local")
    .AddProvider<LocalStorageProvider>("local", opts =>
    {
        opts.BasePath          = storagePath;
        opts.CreateIfNotExists = true;
        opts.PublicBaseUrl     = "http://localhost:5000/files";
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes  = 100_000_000;   // 100 MB
            v.AllowedExtensions = [".jpg", ".jpeg", ".png", ".pdf"];
            v.MinFileSizeBytes  = 1;
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );

var app = builder.Build();

// Hide sidecar files
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.Value?.EndsWith(".meta.json",
            StringComparison.OrdinalIgnoreCase) == true)
    {
        ctx.Response.StatusCode = 404;
        return;
    }
    await next();
});

// Serve storage directory at /files
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(storagePath),
    RequestPath  = "/files"
});

// Register presigned URL token endpoint
app.MapValiBlob();

app.MapControllers();
app.Run();
```

---

## When to Use the Local Provider

| Scenario | Suitable |
|---|---|
| Local development | Yes — zero configuration, instant startup |
| Integration tests | Yes — real file I/O, clean up with `Directory.Delete` |
| Single-server production applications | Yes — when the web server and storage are on the same machine |
| Edge or on-premise deployments | Yes — IoT devices, embedded systems, air-gapped environments |
| Multi-instance deployments (multiple web servers) | No — files are not shared between instances |
| Serverless or ephemeral compute | No — files are lost when containers are recycled |
| Large-scale production (redundancy, CDN) | No — use a cloud provider |

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | |
| `DownloadAsync` | Yes | Including byte range |
| `DeleteAsync` | Yes | Removes file and `.meta.json` sidecar |
| `DeleteFolderAsync` | Yes | `Directory.Delete` recursive |
| `ExistsAsync` | Yes | `File.Exists` |
| `CopyAsync` | Yes | `File.Copy` + sidecar copy |
| `GetMetadataAsync` | Yes | Via `.meta.json` sidecar |
| `SetMetadataAsync` | Yes | Overwrites `.meta.json` |
| `ListFilesAsync` | Yes | `Directory.EnumerateFiles` with prefix |
| `ListFoldersAsync` | Yes | `Directory.EnumerateDirectories` |
| `GetUrlAsync` | Yes | `PublicBaseUrl`-based or `file://` URI |
| `StartResumableUploadAsync` | Yes | Creates `.resumable/{uploadId}/` directory |
| `UploadChunkAsync` | Yes | Writes `{offset}.chunk` file |
| `CompleteResumableUploadAsync` | Yes | Concatenates chunks into final file |
| `AbortResumableUploadAsync` | Yes | Deletes `.resumable/{uploadId}/` directory |
| `GetPresignedUploadUrlAsync` | Yes | HMAC-signed token |
| `GetPresignedDownloadUrlAsync` | Yes | HMAC-signed token |

---

## Related

- [Packages](../packages.md) — Full package reference
- [Presigned URLs](../advanced/presigned-urls.md) — Token-based local presigned URLs
- [Resumable Uploads](../resumable/overview.md) — Chunk-based upload flow
- [Migration](../advanced/migration.md) — Migrate from local storage to a cloud provider
