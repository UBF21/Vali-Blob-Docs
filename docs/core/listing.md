---
id: listing
title: Listing Files and Folders
sidebar_label: Listing
---

# Listing Files and Folders

ValiBlob provides two listing methods: `ListFilesAsync` returns all files under a given path prefix, and `ListFoldersAsync` returns the immediate child "folder" prefixes. Cloud storage systems do not have real directories — they use path prefixes with `/` as a logical delimiter, and ValiBlob maps this model cleanly to both methods.

---

## Method Signatures

```csharp
Task<StorageResult<IReadOnlyList<FileEntry>>> ListFilesAsync(
    string prefix,
    CancellationToken ct = default);

Task<StorageResult<IReadOnlyList<string>>> ListFoldersAsync(
    string prefix,
    CancellationToken ct = default);
```

---

## FileEntry

`FileEntry` is a lightweight record returned by `ListFilesAsync`. It contains essential information about each object without loading full metadata:

```csharp
public sealed record FileEntry
{
    public string         Path         { get; init; }  // Full storage path of the file
    public long           SizeBytes    { get; init; }  // File size in bytes
    public string         ContentType  { get; init; }  // MIME type
    public DateTimeOffset LastModified { get; init; }  // Last modification timestamp
    public string?        ETag         { get; init; }  // Provider entity tag (optional)
}
```

`FileEntry` does not include `CustomMetadata`. To get full metadata for a specific file, call `GetMetadataAsync` with the file's path.

---

## ListFilesAsync

Returns all files whose storage path begins with the given prefix string.

### Basic usage

```csharp
var result = await provider.ListFilesAsync("uploads/images/");

if (result.IsSuccess)
{
    foreach (var entry in result.Value)
    {
        Console.WriteLine($"{entry.Path} ({entry.SizeBytes:N0} bytes) — {entry.ContentType}");
    }
}
else
{
    Console.WriteLine($"List failed: {result.ErrorMessage}");
}
```

### List all files in the bucket

Pass an empty string to list everything:

```csharp
var all = await provider.ListFilesAsync("");
```

:::warning Large buckets
Listing all files in a large bucket without a prefix can be slow, expensive (API call costs), and memory-intensive. Always scope listings to a meaningful prefix in production environments. For a bucket with millions of objects, use a date prefix like `"uploads/2026/03/"` rather than listing the entire bucket.
:::

### List all files with a specific prefix in an HTTP endpoint

```csharp
app.MapGet("/users/{userId}/files", async (string userId, IStorageFactory factory) =>
{
    var result = await factory.Create().ListFilesAsync($"users/{userId}/");

    if (!result.IsSuccess)
        return Results.Problem(result.ErrorMessage);

    return Results.Ok(result.Value.Select(f => new
    {
        f.Path,
        f.SizeBytes,
        f.ContentType,
        f.LastModified,
        FileName = Path.GetFileName(f.Path)
    }));
});
```

---

## ListFoldersAsync

Returns the immediate child prefixes (conceptual "folders") under a given prefix. Only one level deep — it does not recurse.

### Basic usage

```csharp
var result = await provider.ListFoldersAsync("uploads/");

if (result.IsSuccess)
{
    // Returns: ["uploads/images/", "uploads/documents/", "uploads/videos/"]
    foreach (var folder in result.Value)
        Console.WriteLine(folder);
}
```

### Top-level folders

```csharp
var topLevel = await provider.ListFoldersAsync("");
// Returns: ["uploads/", "backups/", "exports/", "cache/"]
```

### Recursive folder traversal

```csharp
public async Task<List<string>> GetAllFoldersRecursiveAsync(
    IStorageProvider provider,
    string rootPrefix,
    CancellationToken ct)
{
    var allFolders = new List<string>();
    var queue      = new Queue<string>();
    queue.Enqueue(rootPrefix);

    while (queue.Count > 0)
    {
        var current     = queue.Dequeue();
        var childResult = await provider.ListFoldersAsync(current, ct);

        if (!childResult.IsSuccess) continue;

        foreach (var folder in childResult.Value)
        {
            allFolders.Add(folder);
            queue.Enqueue(folder);
        }
    }

    return allFolders;
}
```

---

## Prefix-Based Listing Patterns

### List files by date prefix

When files are uploaded with `StoragePath.WithDatePrefix()`, you can efficiently query by date range:

```csharp
// All files uploaded on 2026-03-18
var day = await provider.ListFilesAsync("uploads/2026/03/18/");

// All files uploaded in March 2026
var month = await provider.ListFilesAsync("uploads/2026/03/");

// All files uploaded in 2026
var year = await provider.ListFilesAsync("uploads/2026/");

// Calculate total storage used in March 2026
var marchFiles = await provider.ListFilesAsync("uploads/2026/03/");
if (marchFiles.IsSuccess)
{
    var totalBytes = marchFiles.Value.Sum(f => f.SizeBytes);
    Console.WriteLine($"March 2026: {marchFiles.Value.Count} files, {totalBytes:N0} bytes");
}
```

### List all files for a specific user

```csharp
var userId = "user-abc123";
var result = await provider.ListFilesAsync($"users/{userId}/");

if (result.IsSuccess)
{
    var fileCount  = result.Value.Count;
    var totalBytes = result.Value.Sum(f => f.SizeBytes);
    Console.WriteLine($"User {userId}: {fileCount} files, {totalBytes:N0} bytes");
}
```

### List files by content type (post-fetch filtering)

```csharp
var result = await provider.ListFilesAsync("uploads/");

if (result.IsSuccess)
{
    var images = result.Value
        .Where(f => f.ContentType.StartsWith("image/"))
        .OrderByDescending(f => f.LastModified)
        .ToList();

    Console.WriteLine($"Found {images.Count} images under 'uploads/'");
}
```

---

## Sorting and Filtering Patterns

```csharp
var result = await provider.ListFilesAsync("uploads/");
if (!result.IsSuccess) return;

var files = result.Value;

// Most recently modified first
var byDateDesc = files.OrderByDescending(f => f.LastModified).ToList();

// Oldest first (for processing queues)
var byDateAsc = files.OrderBy(f => f.LastModified).ToList();

// Largest files first
var bySize = files.OrderByDescending(f => f.SizeBytes).ToList();

// Files modified in the last 7 days
var recent = files.Where(f =>
    f.LastModified > DateTimeOffset.UtcNow.AddDays(-7)).ToList();

// Only PDF files
var pdfs = files.Where(f => f.ContentType == "application/pdf").ToList();

// Files larger than 10 MB
var large = files.Where(f => f.SizeBytes > 10_000_000).ToList();

// PDFs larger than 1 MB modified in the last 30 days
var recentLargePdfs = files
    .Where(f => f.ContentType == "application/pdf"
             && f.SizeBytes > 1_000_000
             && f.LastModified > DateTimeOffset.UtcNow.AddDays(-30))
    .OrderByDescending(f => f.LastModified)
    .ToList();
```

---

## Pagination Patterns

ValiBlob's `ListFilesAsync` internally auto-paginates provider API calls (S3 returns max 1,000 per page, Azure 5,000) and returns the full result set. For large result sets, implement application-level pagination using `Skip` and `Take`:

```csharp
public record PagedResult<T>(IReadOnlyList<T> Items, int TotalCount, int PageNumber, int PageSize);

public async Task<PagedResult<FileEntry>> ListPagedAsync(
    IStorageProvider provider,
    string prefix,
    int pageNumber,
    int pageSize,
    CancellationToken ct)
{
    var result = await provider.ListFilesAsync(prefix, ct);

    if (!result.IsSuccess)
        throw new InvalidOperationException($"List failed: {result.ErrorMessage}");

    var ordered = result.Value
        .OrderByDescending(f => f.LastModified)
        .ToList();

    var page = ordered
        .Skip((pageNumber - 1) * pageSize)
        .Take(pageSize)
        .ToList();

    return new PagedResult<FileEntry>(
        Items:      page,
        TotalCount: ordered.Count,
        PageNumber: pageNumber,
        PageSize:   pageSize
    );
}
```

Usage in an endpoint:

```csharp
app.MapGet("/files", async (
    string prefix,
    int page,
    int pageSize,
    IStorageFactory factory) =>
{
    var paged = await ListPagedAsync(factory.Create(), prefix, page, pageSize, default);

    return Results.Ok(new
    {
        paged.TotalCount,
        paged.PageNumber,
        paged.PageSize,
        TotalPages = (int)Math.Ceiling((double)paged.TotalCount / paged.PageSize),
        paged.Items
    });
});
```

---

## Building a File Browser

A complete browser API returning both folders and direct file children at any prefix level:

```csharp
app.MapGet("/browse/{*prefix}", async (string? prefix, IStorageFactory factory) =>
{
    var provider    = factory.Create();
    var normalPrefix = string.IsNullOrEmpty(prefix) ? "" : prefix.TrimEnd('/') + "/";

    var foldersTask = provider.ListFoldersAsync(normalPrefix);
    var filesTask   = provider.ListFilesAsync(normalPrefix);

    await Task.WhenAll(foldersTask, filesTask);

    var foldersResult = await foldersTask;
    var filesResult   = await filesTask;

    if (!foldersResult.IsSuccess || !filesResult.IsSuccess)
        return Results.Problem("Failed to list storage contents.");

    // Return only direct children — exclude files in sub-prefixes
    var directFiles = filesResult.Value
        .Where(f =>
        {
            var relative = f.Path[normalPrefix.Length..];
            return !relative.Contains('/'); // no further path separator = direct child
        })
        .ToList();

    return Results.Ok(new
    {
        prefix      = normalPrefix,
        folders     = foldersResult.Value,
        files       = directFiles.Select(f => new
        {
            f.Path,
            f.SizeBytes,
            f.ContentType,
            LastModified = f.LastModified.ToString("O"),
            FileName     = Path.GetFileName(f.Path)
        }),
        TotalFiles  = directFiles.Count,
        TotalBytes  = directFiles.Sum(f => f.SizeBytes)
    });
});
```

---

## Provider Behavior Notes

| Provider | Internal pagination | Max items auto-paginated | Folder delimiter |
|---|---|---|---|
| AWS S3 | Yes (1,000/page) | Unlimited (auto-paginated) | `/` prefix delimiter |
| Azure Blob | Yes (5,000/page) | Unlimited (auto-paginated) | Virtual directories |
| GCP | Yes (1,000/page) | Unlimited (auto-paginated) | `/` prefix delimiter |
| OCI | Yes | Unlimited (auto-paginated) | `/` prefix delimiter |
| Supabase | Provider default | Provider limit | Folder objects |
| Local | No (filesystem `Directory.EnumerateFiles`) | Unlimited | Real OS directories |

ValiBlob handles all provider-level pagination transparently. However, for buckets with tens of millions of objects, server-side cursor-based pagination using provider SDKs directly may be more efficient. ValiBlob plans to expose native pagination tokens in a future API version.

---

## Related

- [StoragePath](./storage-path.md) — Use `WithDatePrefix()` to make listings filterable by date
- [Metadata](./metadata.md) — Get full `CustomMetadata` for a specific file after listing
- [Upload](./upload.md) — Understanding how path structure affects listing performance
