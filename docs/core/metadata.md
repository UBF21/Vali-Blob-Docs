---
id: metadata
title: File Metadata
sidebar_label: Metadata
---

# File Metadata

ValiBlob provides two operations for working with file metadata: `GetMetadataAsync` retrieves the full metadata record for a file, and `SetMetadataAsync` replaces the custom metadata on an existing file. Metadata is stored as key-value string pairs alongside the object in the storage backend.

---

## Method Signatures

```csharp
Task<StorageResult<FileMetadata>> GetMetadataAsync(
    string path,
    CancellationToken ct = default);

Task<StorageResult> SetMetadataAsync(
    string path,
    Dictionary<string, string> metadata,
    CancellationToken ct = default);
```

---

## FileMetadata Fields

| Field | Type | Description |
|---|---|---|
| `Path` | `string` | Full storage path of the file |
| `SizeBytes` | `long` | File size in bytes (compressed size if `CompressionMiddleware` was used) |
| `ContentType` | `string` | MIME type of the file |
| `CreatedAt` | `DateTimeOffset?` | When the file was first created (null on providers that do not support creation timestamps) |
| `LastModified` | `DateTimeOffset` | When the file was last modified or uploaded |
| `ETag` | `string?` | Entity tag used for cache validation and conditional requests |
| `CustomMetadata` | `IReadOnlyDictionary<string, string>` | All user-defined key-value pairs plus ValiBlob-internal pipeline metadata keys |

### Provider support for optional fields

| Provider | `CreatedAt` | `ETag` format | Max metadata size |
|---|---|---|---|
| AWS S3 | No (use `LastModified` as proxy) | MD5 hex | 2 KB per object |
| Azure Blob | Yes | MD5 hex | 8 KB total |
| GCP | Yes | CRC32C | 8 KB total |
| OCI | Yes | MD5 hex | 2 KB |
| Supabase | Yes | UUID-based | Provider limit |
| Local filesystem | Yes (file creation time) | SHA-256 short | Unlimited (`.meta.json` sidecar) |

:::info Metadata key normalization
Metadata key names are normalized to lowercase when stored. Retrieval is always lowercase regardless of how keys were set at upload time.
:::

---

## GetMetadataAsync

### Basic usage

```csharp
var result = await provider.GetMetadataAsync("uploads/report.pdf");

if (result.IsSuccess)
{
    var meta = result.Value;

    Console.WriteLine($"Path:          {meta.Path}");
    Console.WriteLine($"Size:          {meta.SizeBytes:N0} bytes");
    Console.WriteLine($"Content-Type:  {meta.ContentType}");
    Console.WriteLine($"Created:       {meta.CreatedAt?.ToString() ?? "n/a"}");
    Console.WriteLine($"Last Modified: {meta.LastModified}");
    Console.WriteLine($"ETag:          {meta.ETag ?? "n/a"}");

    Console.WriteLine("Custom metadata:");
    foreach (var (key, value) in meta.CustomMetadata)
        Console.WriteLine($"  {key} = {value}");
}
else if (result.ErrorCode == StorageErrorCode.FileNotFound)
{
    Console.WriteLine("File does not exist.");
}
```

### In an ASP.NET Core endpoint

```csharp
app.MapGet("/files/{*path}/info", async (string path, IStorageFactory factory) =>
{
    var result = await factory.Create().GetMetadataAsync(path);

    return result switch
    {
        { IsSuccess: true } => Results.Ok(new
        {
            result.Value.Path,
            result.Value.SizeBytes,
            result.Value.ContentType,
            result.Value.LastModified,
            result.Value.ETag,
            CustomMetadata = result.Value.CustomMetadata.ToDictionary(kv => kv.Key, kv => kv.Value)
        }),
        { ErrorCode: StorageErrorCode.FileNotFound } => Results.NotFound(),
        _ => Results.Problem(result.ErrorMessage)
    };
});
```

---

## SetMetadataAsync

`SetMetadataAsync` **replaces** the entire custom metadata dictionary on the file. System-managed keys (like `x-vali-iv` for encryption and `x-vali-compressed` for compression) are preserved internally and cannot be overwritten via this method.

### Basic usage

```csharp
var result = await provider.SetMetadataAsync("uploads/report.pdf", new Dictionary<string, string>
{
    ["approved-by"]   = "john.doe@company.com",
    ["approved-at"]   = DateTimeOffset.UtcNow.ToString("O"),
    ["document-type"] = "financial-report",
    ["retention"]     = "7years",
    ["status"]        = "approved"
});

if (!result.IsSuccess)
    Console.WriteLine($"Failed to set metadata: {result.ErrorMessage}");
```

:::warning Replace semantics
`SetMetadataAsync` is a full replacement, not a partial update. Calling it will overwrite all existing user metadata keys. To add or update individual keys while preserving others, read the current metadata first, merge the changes, then call `SetMetadataAsync`:

```csharp
var current = await provider.GetMetadataAsync(path);
if (!current.IsSuccess) return;

// Merge: start with existing custom metadata, add/update specific keys
var updated = current.Value.CustomMetadata.ToDictionary(kv => kv.Key, kv => kv.Value);
updated["status"]     = "reviewed";
updated["reviewed-by"] = "alice@company.com";

await provider.SetMetadataAsync(path, updated);
```
:::

---

## ValiBlob Internal Metadata Keys

ValiBlob stores pipeline state in custom metadata. These keys are reserved and have special meaning:

| Key | Set by | Value | Purpose |
|---|---|---|---|
| `x-vali-iv` | `EncryptionMiddleware` | Base64-encoded 16-byte AES-CBC IV | Required for transparent decryption on download |
| `x-vali-compressed` | `CompressionMiddleware` | `gzip` | Signals that the file content is GZip-compressed |
| `x-vali-hash` | `DeduplicationMiddleware` | SHA-256 hex | Content hash for deduplication lookups |
| `x-vali-original-size` | `CompressionMiddleware` | Numeric string (bytes) | Uncompressed file size before GZip compression |

You can read these keys via `GetMetadataAsync` to inspect pipeline state:

```csharp
var meta = await provider.GetMetadataAsync("uploads/file.pdf");

if (meta.IsSuccess)
{
    var isEncrypted  = meta.Value.CustomMetadata.ContainsKey("x-vali-iv");
    var isCompressed = meta.Value.CustomMetadata.TryGetValue("x-vali-compressed", out var algo)
                       && algo == "gzip";

    Console.WriteLine($"Encrypted:  {isEncrypted}");
    Console.WriteLine($"Compressed: {isCompressed}");

    if (isCompressed && meta.Value.CustomMetadata.TryGetValue("x-vali-original-size", out var origSizeStr))
    {
        var originalSize = long.Parse(origSizeStr);
        var storedSize   = meta.Value.SizeBytes;
        var ratio        = 1.0 - (double)storedSize / originalSize;
        Console.WriteLine($"Compression ratio: {ratio:P1}");
    }
}
```

---

## Use Cases

### Tagging files with user and session context

```csharp
// At upload time, embed user identity and session context in metadata
await provider.UploadAsync(new UploadRequest
{
    Path    = path,
    Content = stream,
    Metadata = new Dictionary<string, string>
    {
        ["user-id"]     = currentUserId,
        ["tenant-id"]   = tenantId,
        ["uploaded-at"] = DateTimeOffset.UtcNow.ToString("O"),
        ["ip-address"]  = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        ["request-id"]  = httpContext.TraceIdentifier,
        ["source"]      = "web-upload"
    }
});
```

### Marking file review status

```csharp
public async Task ApproveDocumentAsync(
    string filePath,
    string reviewerId,
    CancellationToken ct)
{
    // Preserve all existing metadata, add approval fields
    var current = await provider.GetMetadataAsync(filePath, ct);
    if (!current.IsSuccess) return;

    var updated = current.Value.CustomMetadata.ToDictionary(kv => kv.Key, kv => kv.Value);
    updated["status"]        = "approved";
    updated["reviewed-by"]   = reviewerId;
    updated["reviewed-at"]   = DateTimeOffset.UtcNow.ToString("O");

    await provider.SetMetadataAsync(filePath, updated, ct);
}
```

### Content-type inspection for conditional processing

```csharp
var meta = await provider.GetMetadataAsync(path);

if (meta.IsSuccess && meta.Value.ContentType.StartsWith("image/"))
{
    // Queue image for thumbnail generation
    await _queue.EnqueueAsync(new GenerateThumbnailJob(path));
}
else if (meta.IsSuccess && meta.Value.ContentType == "application/pdf")
{
    // Queue PDF for text extraction and indexing
    await _queue.EnqueueAsync(new ExtractTextJob(path));
}
```

### Stale cache detection

```csharp
public async Task<bool> IsCacheStaleAsync(string cachePath, TimeSpan maxAge)
{
    var meta = await provider.GetMetadataAsync(cachePath);

    if (!meta.IsSuccess)
        return true; // file doesn't exist — definitely stale

    var age = DateTimeOffset.UtcNow - meta.Value.LastModified;
    return age > maxAge;
}

// Usage
if (await IsCacheStaleAsync("cache/exchange-rates.json", TimeSpan.FromHours(1)))
{
    var freshData = await FetchFreshExchangeRatesAsync();
    await provider.UploadAsync(new UploadRequest
    {
        Path        = "cache/exchange-rates.json",
        Content     = new MemoryStream(Encoding.UTF8.GetBytes(freshData)),
        ContentType = "application/json"
    });
}
```

### ETag-based cache validation

```csharp
public async Task<(bool Changed, Stream? Content)> DownloadIfChangedAsync(
    string path,
    string? lastKnownETag)
{
    var meta = await provider.GetMetadataAsync(path);
    if (!meta.IsSuccess) return (true, null);

    if (meta.Value.ETag == lastKnownETag)
        return (false, null); // not changed

    var result = await provider.DownloadAsync(new DownloadRequest { Path = path });
    return result.IsSuccess ? (true, result.Value) : (true, null);
}
```

### Versioning pattern

```csharp
public async Task ArchiveVersionAsync(string path, int version, CancellationToken ct)
{
    // Tag the file with the version number in metadata
    var current = await provider.GetMetadataAsync(path, ct);
    if (!current.IsSuccess) return;

    var updated = current.Value.CustomMetadata.ToDictionary(kv => kv.Key, kv => kv.Value);
    updated["document-version"] = version.ToString();
    updated["archived-at"]      = DateTimeOffset.UtcNow.ToString("O");

    await provider.SetMetadataAsync(path, updated, ct);
}
```

---

## Setting Metadata at Upload Time

Rather than setting metadata in a separate call after upload, set it directly in `UploadRequest.Metadata`:

```csharp
var result = await provider.UploadAsync(new UploadRequest
{
    Path    = StoragePath.From("documents", docId, "contract.pdf"),
    Content = pdfStream,
    ContentType = "application/pdf",
    Metadata = new Dictionary<string, string>
    {
        ["doc-type"]     = "contract",
        ["client-id"]    = clientId,
        ["created-by"]   = currentUserId,
        ["created-at"]   = DateTimeOffset.UtcNow.ToString("O"),
        ["confidential"] = "true"
    }
});
```

This is more efficient than a separate `SetMetadataAsync` call because it avoids a round-trip to the storage backend.

---

## Related

- [Upload](./upload.md) — Set metadata at upload time via `UploadRequest.Metadata`
- [Listing](./listing.md) — `FileEntry` contains a subset of metadata fields
- [Encryption](../pipeline/encryption.md) — How `x-vali-iv` is stored and used
- [Compression](../pipeline/compression.md) — How `x-vali-compressed` and `x-vali-original-size` are stored
- [Deduplication](../pipeline/deduplication.md) — How `x-vali-hash` is stored
