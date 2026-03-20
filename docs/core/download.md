---
id: download
title: Downloading Files
sidebar_label: Download
---

# Downloading Files

`DownloadAsync` retrieves file content from the storage backend as a `Stream`. If compression or encryption middlewares were used during upload, the stream returned by `DownloadAsync` is automatically decompressed and decrypted before it reaches your application code — you always see the original, unmodified bytes.

---

## Method Signature

```csharp
Task<StorageResult<Stream>> DownloadAsync(
    DownloadRequest request,
    CancellationToken ct = default);
```

---

## DownloadRequest Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `Path` | `StoragePath` | Required | Storage path of the file to download |
| `Range` | `DownloadRange?` | `null` | Byte range for partial content (video streaming, resume download) |
| `AutoDecrypt` | `bool` | `true` | Apply transparent decryption if `x-vali-iv` metadata is present |
| `AutoDecompress` | `bool` | `true` | Apply transparent decompression if `x-vali-compressed` metadata is `gzip` |

### DownloadRange

```csharp
public sealed class DownloadRange
{
    public long  From { get; init; }   // inclusive byte offset (0-based)
    public long? To   { get; init; }   // inclusive end byte — null = read to end of file
}
```

---

## Basic Download Examples

### Stream to HTTP response (Minimal API)

```csharp
app.MapGet("/files/{*path}", async (string path, IStorageFactory factory) =>
{
    var provider = factory.Create();

    var result = await provider.DownloadAsync(new DownloadRequest { Path = path });

    if (!result.IsSuccess)
    {
        return result.ErrorCode == StorageErrorCode.FileNotFound
            ? Results.NotFound()
            : Results.Problem(result.ErrorMessage);
    }

    // Stream directly — result.Value is disposed automatically by Results.Stream
    return Results.Stream(result.Value, contentType: "application/octet-stream");
});
```

### Stream to HTTP response with content-type (Controller)

```csharp
[HttpGet("{*path}")]
public async Task<IActionResult> Download(string path, CancellationToken ct)
{
    var downloadResult = await _provider.DownloadAsync(
        new DownloadRequest { Path = path }, ct);

    if (!downloadResult.IsSuccess)
    {
        return downloadResult.ErrorCode == StorageErrorCode.FileNotFound
            ? NotFound()
            : StatusCode(500, downloadResult.ErrorMessage);
    }

    // Fetch metadata to set the correct content-type and filename
    var metaResult  = await _provider.GetMetadataAsync(path, ct);
    var contentType = metaResult.IsSuccess
        ? metaResult.Value.ContentType
        : "application/octet-stream";

    var fileName = Path.GetFileName(path);
    Response.Headers.ContentDisposition = $"attachment; filename=\"{fileName}\"";

    return File(downloadResult.Value, contentType);
}
```

### Read entire file into memory (for small files only)

```csharp
var result = await provider.DownloadAsync(new DownloadRequest
{
    Path = "config/settings.json"
});

if (!result.IsSuccess)
    throw new InvalidOperationException($"Failed to load config: {result.ErrorMessage}");

using var reader = new StreamReader(result.Value);
var json = await reader.ReadToEndAsync();
var settings = JsonSerializer.Deserialize<AppSettings>(json);
```

:::warning Only use ReadToEnd for small files
Reading an entire file into memory with `ReadToEndAsync` or `ToArray()` will allocate the full file size on the heap. For large files (images, videos, documents), always stream the content to the response or to a file directly without buffering.
:::

---

## Streaming to a Local File

```csharp
var result = await provider.DownloadAsync(new DownloadRequest
{
    Path = "backups/database-2026-03-18.sql.gz"
});

if (!result.IsSuccess)
{
    Console.WriteLine($"Download failed: {result.ErrorMessage}");
    return;
}

await using var fileStream = File.Create("/tmp/backup.sql.gz");
await result.Value.CopyToAsync(fileStream);
Console.WriteLine("Download complete.");
```

---

## Range Downloads

Range downloads retrieve only a portion of a file. This is essential for:

- **Video streaming** — serve only the bytes the player needs for the current playhead position
- **Resuming interrupted downloads** — start from the last successfully received byte
- **Efficient seeking** — jump to a specific offset in a large archive

```csharp
// First 1 MB
var result = await provider.DownloadAsync(new DownloadRequest
{
    Path  = "videos/lecture.mp4",
    Range = new DownloadRange { From = 0, To = 1_048_575 }
});

// Second megabyte
var result2 = await provider.DownloadAsync(new DownloadRequest
{
    Path  = "videos/lecture.mp4",
    Range = new DownloadRange { From = 1_048_576, To = 2_097_151 }
});

// From byte offset 5 MB to end of file
var result3 = await provider.DownloadAsync(new DownloadRequest
{
    Path  = "videos/lecture.mp4",
    Range = new DownloadRange { From = 5_000_000 } // To = null means end of file
});
```

### HTTP Range request handler

The following minimal API endpoint implements the HTTP `Range` header protocol, enabling `<video>` element seeking and partial content serving:

```csharp
app.MapGet("/stream/{*path}", async (
    string path,
    HttpContext ctx,
    IStorageFactory factory) =>
{
    var provider = factory.Create();

    // Get metadata to know total file size and content-type
    var meta = await provider.GetMetadataAsync(path);
    if (!meta.IsSuccess)
        return Results.NotFound();

    var totalBytes  = meta.Value.SizeBytes;
    var contentType = meta.Value.ContentType;

    // Parse "Range: bytes=start-end" header
    DownloadRange? range = null;
    var statusCode = 200;

    if (ctx.Request.Headers.TryGetValue("Range", out var rangeHeader))
    {
        var parts = rangeHeader.ToString().Replace("bytes=", "").Split('-');
        var from  = long.Parse(parts[0]);
        var to    = parts[1].Length > 0
            ? long.Parse(parts[1])
            : Math.Min(from + 1_048_576 - 1, totalBytes - 1); // 1 MB chunk

        range      = new DownloadRange { From = from, To = to };
        statusCode = 206; // Partial Content
    }

    var result = await provider.DownloadAsync(new DownloadRequest
    {
        Path  = path,
        Range = range
    });

    if (!result.IsSuccess)
        return Results.Problem(result.ErrorMessage);

    if (statusCode == 206)
    {
        ctx.Response.StatusCode = 206;
        ctx.Response.Headers.ContentRange =
            $"bytes {range!.From}-{range.To}/{totalBytes}";
        ctx.Response.Headers.AcceptRanges = "bytes";
    }

    return Results.Stream(result.Value, contentType: contentType);
});
```

:::info Range support by provider
Range downloads are supported natively by AWS S3, Azure Blob, GCP, OCI, and the Local provider. On providers without native range support, ValiBlob downloads the full file and returns a subrange stream, which is less efficient.
:::

---

## Auto-Decryption and Auto-Decompression

When `EncryptionMiddleware` is active, uploads store the AES-256-CBC initialization vector in the object's `x-vali-iv` metadata header. On download, `BaseStorageProvider` detects this metadata and applies decryption automatically before returning the stream.

Similarly, `CompressionMiddleware` stores `x-vali-compressed=gzip` in metadata. On download, the stream is wrapped in a `GZipStream` for transparent decompression.

| Metadata key present | AutoDecrypt / AutoDecompress setting | Behavior |
|---|---|---|
| `x-vali-iv` | `AutoDecrypt = true` (default) | Stream is AES-256-CBC decrypted |
| `x-vali-compressed = gzip` | `AutoDecompress = true` (default) | Stream is GZip decompressed |
| Neither | Any | Stream returned as-is |
| `x-vali-iv` | `AutoDecrypt = false` | Raw ciphertext returned |
| `x-vali-compressed = gzip` | `AutoDecompress = false` | Raw compressed bytes returned |

The transforms are applied in reverse upload order: **decrypt first, then decompress**.

### Opt out of auto-decryption

Use this to retrieve raw encrypted bytes, for example to forward them to another system that decrypts independently:

```csharp
var result = await provider.DownloadAsync(new DownloadRequest
{
    Path        = "secure/private-key.bin",
    AutoDecrypt = false   // returns raw ciphertext bytes
});
```

### Opt out of auto-decompression

Use this to forward the compressed bytes directly to a client that supports `Content-Encoding: gzip`:

```csharp
var result = await provider.DownloadAsync(new DownloadRequest
{
    Path           = "exports/large-dataset.json",
    AutoDecompress = false   // returns raw gzip bytes
});

// Tell the browser to decompress on the client side
ctx.Response.Headers.ContentEncoding = "gzip";
return Results.Stream(result.Value, contentType: "application/json");
```

---

## Checking Existence Before Downloading

```csharp
var exists = await provider.ExistsAsync("uploads/report.pdf");

if (!exists.IsSuccess || !exists.Value)
    return Results.NotFound("File not found.");

var result = await provider.DownloadAsync(new DownloadRequest
{
    Path = "uploads/report.pdf"
});
```

:::tip Prefer handling FileNotFound in the download result
You generally do not need to call `ExistsAsync` before `DownloadAsync`. If the file does not exist, `DownloadAsync` returns `StorageResult.Failure(StorageErrorCode.FileNotFound, ...)` directly. The two-step pattern adds a round-trip network call and introduces a TOCTOU race condition. Handle `FileNotFound` in the download result instead.
:::

---

## Fetching Metadata and Content Together

When you need both the file stream and its metadata simultaneously:

```csharp
var downloadTask = provider.DownloadAsync(new DownloadRequest { Path = "uploads/doc.pdf" });
var metaTask     = provider.GetMetadataAsync("uploads/doc.pdf");

await Task.WhenAll(downloadTask, metaTask);

var downloadResult = await downloadTask;
var metaResult     = await metaTask;

if (downloadResult.IsSuccess && metaResult.IsSuccess)
{
    var contentType = metaResult.Value.ContentType;
    var sizeBytes   = metaResult.Value.SizeBytes;

    Console.WriteLine($"Streaming {sizeBytes:N0} bytes of {contentType}");
    await using var stream = downloadResult.Value;
    // ... use stream
}
```

---

## Generating a URL Instead of Proxying

If you want the client to download the file directly from the storage backend — bypassing your server and saving bandwidth — use `GetUrlAsync`:

```csharp
var urlResult = await provider.GetUrlAsync("uploads/public-report.pdf");

if (urlResult.IsSuccess)
    return Results.Redirect(urlResult.Value);
```

For time-limited access to private files, use presigned URLs via `IPresignedUrlProvider`:

```csharp
if (provider is IPresignedUrlProvider presigned)
{
    var signedUrl = await presigned.GetPresignedDownloadUrlAsync(
        "private/salary-data.csv",
        expiresIn: TimeSpan.FromMinutes(15));

    if (signedUrl.IsSuccess)
        return Results.Redirect(signedUrl.Value);
}
```

---

## Disposing the Stream

The returned `Stream` must be disposed after use. Use `await using` to ensure disposal even on exceptions:

```csharp
var result = await provider.DownloadAsync(new DownloadRequest { Path = "file.txt" });

if (result.IsSuccess)
{
    await using var stream = result.Value; // disposed when the using block exits
    using var reader = new StreamReader(stream);
    var text = await reader.ReadToEndAsync();
    Console.WriteLine(text);
}
```

:::warning Do not dispose before the response is sent
When using `Results.Stream(result.Value)`, do **not** dispose the stream before passing it. ASP.NET Core disposes the stream automatically after the response body is written. Wrapping it in a `using` block before returning from the endpoint handler will close the stream before it can be sent.
:::

---

## Related

- [Upload](./upload.md) — Store files with optional compression and encryption
- [Metadata](./metadata.md) — Retrieve content-type, size, and custom metadata
- [StorageResult](./storage-result.md) — Handle `FileNotFound`, `AccessDenied`, and other errors
- [Compression](../pipeline/compression.md) — How GZip compression affects downloads
- [Encryption](../pipeline/encryption.md) — How AES-256-CBC encryption affects downloads
