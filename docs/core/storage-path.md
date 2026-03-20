---
title: StoragePath
sidebar_label: StoragePath
---

# StoragePath

`StoragePath` is a utility type for building **safe, consistent, cloud-ready file paths**. It normalizes path separators, sanitizes unsafe characters, and provides composable helpers for adding time-based prefixes, hash suffixes, and random suffixes that make object keys unique and sortable.

---

## Why StoragePath?

Cloud storage systems identify objects by string keys (S3), blob names (Azure), or object names (GCP). Without a consistent path strategy, issues accumulate quickly:

- User-supplied filenames contain spaces, parentheses, and Unicode characters that may not be safe in all storage backends.
- Mixing OS path separators (`\` on Windows) causes objects to be created under unexpected prefixes.
- Files with the same name from different users collide.
- Hot-spot prefixes (all files under `"uploads/"`) degrade S3 performance on large buckets.

`StoragePath` solves all of these with a single, composable API.

```csharp
// Fragile — concatenation, OS separator, raw user filename
var path = userId + "/" + file.FileName;  // "123/My Report (Final) v2.pdf"

// Safe — normalized, sanitized, unique
var path = StoragePath
    .From("users", userId, StoragePath.Sanitize(file.FileName))
    .WithDatePrefix()
    .WithRandomSuffix();
// → "2026/03/18/users/123/my-report-final-v2_k9p2x.pdf"
```

---

## Creating Paths

### `StoragePath.From(params string[] segments)`

Joins one or more segments with `/` and normalizes the result:

```csharp
StoragePath.From("users", "123", "avatar.png")
// → "users/123/avatar.png"

StoragePath.From("uploads", DateTime.UtcNow.Year.ToString(), "report.pdf")
// → "uploads/2026/report.pdf"

StoragePath.From("a", "b", "c", "d", "file.txt")
// → "a/b/c/d/file.txt"
```

Empty and whitespace-only segments are ignored, and leading/trailing slashes in any segment are trimmed:

```csharp
StoragePath.From("users", "", "123", "/avatar.png", "")
// → "users/123/avatar.png"

StoragePath.From("/uploads/", "subdir/", "/file.txt")
// → "uploads/subdir/file.txt"
```

---

## Path Helpers

All helper methods return a **new** `StoragePath` instance. The original is never modified (the type is immutable). Helpers can be chained freely.

### `WithDatePrefix()`

Prepends the current UTC date as `YYYY/MM/DD/`:

```csharp
StoragePath.From("users", "123", "avatar.png").WithDatePrefix()
// → "2026/03/18/users/123/avatar.png"
```

**Why:** Time-partitioned prefixes improve `ListObjects` performance on large S3 buckets, and make it easy to find or expire files by date. This is a best practice for S3 at scale.

### `WithTimestampPrefix()`

Prepends a compact UTC timestamp as `YYYYMMDDTHHmmss/`:

```csharp
StoragePath.From("uploads", "report.pdf").WithTimestampPrefix()
// → "20260318T143022/uploads/report.pdf"
```

**Why:** When you need chronological ordering within a prefix and the date alone is not granular enough. Suitable for event logs, audit records, or any scenario where order of creation matters.

### `WithHashSuffix()`

Appends a short 6-character SHA-256 hash of the full path string to the filename stem, before the extension:

```csharp
StoragePath.From("users", "123", "avatar.png").WithHashSuffix()
// → "users/123/avatar_a3f7b2.png"
```

**Why:** The hash is deterministic — the same path always yields the same suffix. This makes paths stable for cache-busting: changing the file content without changing the path still changes the suffix, invalidating CDN caches.

### `WithRandomSuffix()`

Appends a cryptographically random 5-character alphanumeric string to the filename stem:

```csharp
StoragePath.From("users", "123", "avatar.png").WithRandomSuffix()
// → "users/123/avatar_x9k2m.png"

// Each call produces a different suffix
StoragePath.From("users", "123", "avatar.png").WithRandomSuffix()
// → "users/123/avatar_7bqnp.png"
```

**Why:** Prevents filename collisions when the same user uploads a file with the same name multiple times. Unlike `WithHashSuffix`, this always produces a new path even for identical content.

---

## Sanitization

### `StoragePath.Sanitize(string rawInput)`

Converts a raw filename or path string into a safe storage path:

- Converts to **lowercase**
- Replaces spaces with **hyphens**
- Replaces unsafe characters (`(`, `)`, `[`, `]`, `@`, `#`, `!`, etc.) with **hyphens**
- Collapses consecutive hyphens into a single hyphen
- Preserves `/` as path separator
- Preserves `.` before extensions
- Removes leading/trailing slashes and whitespace

```csharp
StoragePath.Sanitize("Hello World.txt")
// → "hello-world.txt"

StoragePath.Sanitize("My Report (Final) v2.pdf")
// → "my-report-final-v2.pdf"

StoragePath.Sanitize("  /uploads/Report Q1 2026.PDF  ")
// → "uploads/report-q1-2026.pdf"

StoragePath.Sanitize("avatar@user#123!.png")
// → "avatar-user-123-.png"

StoragePath.Sanitize("file___name---.txt")
// → "file-name-.txt"
```

:::tip Always sanitize user-supplied filenames
Never use `IFormFile.FileName` directly in a `StoragePath`. Users can submit filenames with path traversal sequences (`../../etc/passwd`), Unicode characters, or characters that are invalid in certain cloud storage backends.

```csharp
// Safe
var safeName = StoragePath.Sanitize(file.FileName);
var path = StoragePath.From("uploads", userId, safeName);

// Unsafe — never do this
var path = StoragePath.From("uploads", userId, file.FileName);
```
:::

---

## Input → Output Reference Table

| Input | Output | Notes |
|---|---|---|
| `"Hello World.txt"` | `"hello-world.txt"` | Sanitize: space → hyphen |
| `"My File (2024).pdf"` | `"my-file-2024.pdf"` | Sanitize: parentheses removed |
| `"avatar.png"` with `WithDatePrefix()` | `"2026/03/18/avatar.png"` | Date prefix |
| `"report.pdf"` with `WithTimestampPrefix()` | `"20260318T143022/report.pdf"` | Timestamp prefix |
| `"users/123/avatar.png"` with `WithHashSuffix()` | `"users/123/avatar_a3f7b2.png"` | Hash suffix (deterministic) |
| `"users/123/avatar.png"` with `WithRandomSuffix()` | `"users/123/avatar_x9k2m.png"` | Random suffix (non-deterministic) |
| `From("a", "", "b", "/c")` | `"a/b/c"` | Empty and slash segments trimmed |
| `From("/uploads/", "file.txt")` | `"uploads/file.txt"` | Leading/trailing slashes removed |
| `Sanitize("UPPERCASE.PNG")` | `"uppercase.png"` | Lowercased |
| `Sanitize("file___name.txt")` | `"file-name.txt"` | Consecutive hyphens collapsed |

---

## Implicit Conversion

`StoragePath` implicitly converts to and from `string`, so you can use it anywhere a string path is expected:

```csharp
// Implicit to string
string pathString = StoragePath.From("uploads", "file.txt");
// pathString = "uploads/file.txt"

// Implicit from string
StoragePath path = "uploads/file.txt";
Console.WriteLine(path); // "uploads/file.txt"

// Works with all IStorageProvider methods that accept string paths
var exists = await provider.ExistsAsync(StoragePath.From("uploads", "file.txt"));
var deleted = await provider.DeleteAsync(StoragePath.From("uploads", "old.txt"));
```

---

## Properties and Decomposition

```csharp
var path = StoragePath.From("users", "123", "avatar.png");

Console.WriteLine(path);             // "users/123/avatar.png"
Console.WriteLine(path.Value);       // "users/123/avatar.png"
Console.WriteLine(path.Directory);   // "users/123"
Console.WriteLine(path.FileName);    // "avatar.png"
Console.WriteLine(path.Extension);   // ".png"
Console.WriteLine(path.Stem);        // "avatar"  (filename without extension)
```

---

## Combining Helpers

Helpers chain in any order. The most common patterns:

```csharp
// User-uploaded file: sanitize name, add date prefix, add random suffix for uniqueness
var path = StoragePath
    .From("users", userId, StoragePath.Sanitize(file.FileName))
    .WithDatePrefix()
    .WithRandomSuffix();
// → "2026/03/18/users/abc123/my-report_k2x9p.pdf"

// Versioned document: no random suffix needed because version is in the name
var path = StoragePath.From("documents", docId, $"v{version}.pdf");
// → "documents/doc-xyz/v3.pdf"

// Time-ordered event log: timestamp prefix for natural ordering
var path = StoragePath
    .From("events", eventType, "payload.json")
    .WithTimestampPrefix();
// → "20260318T143022/events/order-placed/payload.json"

// CDN-cacheable asset: hash suffix for cache busting
var path = StoragePath
    .From("assets", "styles", "main.css")
    .WithHashSuffix();
// → "assets/styles/main_f7a3b2.css"
```

---

## Use Cases

### User file upload endpoint

```csharp
app.MapPost("/users/{userId}/files", async (
    string userId,
    IFormFile file,
    IStorageFactory factory) =>
{
    var safeName    = StoragePath.Sanitize(file.FileName);
    var storagePath = StoragePath
        .From("users", userId, safeName)
        .WithDatePrefix()
        .WithRandomSuffix();

    var result = await factory.Create().UploadAsync(new UploadRequest
    {
        Path        = storagePath,
        Content     = file.OpenReadStream(),
        ContentType = file.ContentType,
        ContentLength = file.Length
    });

    return result.IsSuccess
        ? Results.Ok(new { path = storagePath.Value, url = result.Value.Url })
        : Results.Problem(result.ErrorMessage);
}).DisableAntiforgery();
```

### Versioned document storage

```csharp
public StoragePath BuildVersionedPath(string documentId, int version, string extension)
{
    // "documents/doc-abc123/v3.pdf"
    return StoragePath.From("documents", documentId, $"v{version}{extension}");
}
```

### Time-partitioned media archive

```csharp
public StoragePath BuildMediaPath(string category, string rawFileName)
{
    // "2026/03/18/videos/my-conference-talk.mp4"
    return StoragePath
        .From(category, StoragePath.Sanitize(rawFileName))
        .WithDatePrefix();
}
```

### Generating a thumbnail path from an original path

```csharp
public StoragePath ToThumbnailPath(StoragePath originalPath)
{
    // "users/123/avatar.png" → "thumbnails/users/123/avatar.png"
    return StoragePath.From("thumbnails", originalPath.Value);
}
```

---

## Related

- [Upload](./upload.md) — `UploadRequest.Path` accepts `StoragePath`
- [Download](./download.md) — `DownloadRequest.Path` accepts `StoragePath`
- [Conflict Resolution](../pipeline/conflict-resolution.md) — Use `WithRandomSuffix` to avoid conflicts automatically
- [Listing](./listing.md) — Use a `StoragePath` as the prefix for `ListFilesAsync`
