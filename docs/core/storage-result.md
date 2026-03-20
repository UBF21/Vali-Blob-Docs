---
title: StorageResult Pattern
sidebar_label: StorageResult
---

# StorageResult Pattern

ValiBlob uses a **result type** instead of exceptions for all expected failure conditions. Every method on `IStorageProvider` returns either `StorageResult<T>` (for operations that return a value) or `StorageResult` (for void operations like delete). This makes error handling explicit, composable, and free of `try/catch` boilerplate for anticipated failures.

---

## Why a Result Type?

Throwing exceptions for expected conditions — like a file not being found or a quota being exceeded — is expensive, surprises callers, and makes control flow hard to follow. A result type communicates that failure is a normal outcome, not an exceptional one.

Compare:

```csharp
// Without result type: caller must know to catch specific exceptions
try
{
    var stream = await provider.DownloadAsync(path);
    // use stream
}
catch (FileNotFoundException) { return NotFound(); }
catch (AccessDeniedException) { return Forbid(); }
catch (Exception ex)          { return StatusCode(500, ex.Message); }
```

```csharp
// With StorageResult: failure is explicit and enumerable
var result = await provider.DownloadAsync(new DownloadRequest { Path = path });

return result.ErrorCode switch
{
    null when result.IsSuccess           => Results.Stream(result.Value),
    StorageErrorCode.FileNotFound        => Results.NotFound(),
    StorageErrorCode.AccessDenied        => Results.Forbid(),
    _                                    => Results.Problem(result.ErrorMessage)
};
```

---

## Type Definitions

```csharp
// For operations that return a value (Upload, Download, GetMetadata, ListFiles, etc.)
public sealed class StorageResult<T>
{
    public bool              IsSuccess    { get; }
    public bool              IsFailure    => !IsSuccess;
    public T?                Value        { get; }        // non-null when IsSuccess == true
    public StorageErrorCode? ErrorCode    { get; }        // non-null when IsFailure == true
    public string?           ErrorMessage { get; }        // human-readable description

    // Factory methods used by providers and middleware
    public static StorageResult<T> Success(T value);
    public static StorageResult<T> Failure(StorageErrorCode code, string message);
}

// For void operations (Delete, DeleteFolder, SetMetadata, Copy)
public sealed class StorageResult
{
    public bool              IsSuccess    { get; }
    public bool              IsFailure    => !IsSuccess;
    public StorageErrorCode? ErrorCode    { get; }
    public string?           ErrorMessage { get; }

    public static StorageResult Success();
    public static StorageResult Failure(StorageErrorCode code, string message);
}
```

:::warning Do not access Value when IsFailure
When `result.IsFailure` is `true`, `result.Value` is `null` (or `default` for value types). Accessing `result.Value` without first checking `result.IsSuccess` will cause a `NullReferenceException` at runtime. Always gate access to `Value` behind an `IsSuccess` check.
:::

---

## Basic Usage Pattern

### Upload

```csharp
var result = await provider.UploadAsync(request);

if (result.IsSuccess)
{
    Console.WriteLine($"File URL:  {result.Value.Url}");
    Console.WriteLine($"File path: {result.Value.Path}");
    Console.WriteLine($"File size: {result.Value.SizeBytes:N0} bytes");
}
else
{
    Console.WriteLine($"Error [{result.ErrorCode}]: {result.ErrorMessage}");
}
```

### Download

```csharp
var result = await provider.DownloadAsync(new DownloadRequest { Path = "uploads/report.pdf" });

if (result.IsSuccess)
{
    // result.Value is a Stream — read it or stream to response
    using var reader = new StreamReader(result.Value);
    var content = await reader.ReadToEndAsync();
}
else if (result.ErrorCode == StorageErrorCode.FileNotFound)
{
    Console.WriteLine("File does not exist.");
}
```

### Delete (void result)

```csharp
var result = await provider.DeleteAsync("uploads/old-file.pdf");

if (result.IsSuccess)
    Console.WriteLine("Deleted.");
else
    Console.WriteLine($"Failed: {result.ErrorMessage}");
```

---

## StorageErrorCode Reference

The `StorageErrorCode` enum covers all well-known failure conditions. Every ValiBlob provider maps its internal errors to one of these codes.

| Error Code | When it occurs | Typical HTTP Status |
|---|---|---|
| `FileNotFound` | The requested path does not exist in the storage backend | 404 |
| `AccessDenied` | Insufficient permissions — wrong credentials, expired token, missing IAM role | 403 |
| `QuotaExceeded` | `QuotaMiddleware` threshold was reached (total bytes or file count) | 507 |
| `ValidationFailed` | File rejected by `ValidationMiddleware` — wrong extension, too large, blocked content type | 400 |
| `VirusScanFailed` | `VirusScanMiddleware` detected a threat — `ErrorMessage` includes the threat name | 422 |
| `Duplicate` | `DeduplicationMiddleware` found an existing file with identical content | 200 or 409 |
| `Conflict` | `ConflictResolutionMiddleware` with `Fail` strategy — a file already exists at the path | 409 |
| `ProviderError` | Provider-level error — network timeout, SDK exception, throttling, transient cloud error | 502 or 503 |
| `Unknown` | Unclassified exception caught at the provider level | 500 |

### Handling each code

```csharp
var result = await provider.UploadAsync(request);

if (result.IsSuccess)
{
    return Results.Created($"/files/{result.Value.Path}", new { url = result.Value.Url });
}

return result.ErrorCode switch
{
    StorageErrorCode.FileNotFound =>
        Results.NotFound(),

    StorageErrorCode.AccessDenied =>
        Results.Forbid(),

    StorageErrorCode.ValidationFailed =>
        Results.BadRequest(new { error = result.ErrorMessage }),

    StorageErrorCode.QuotaExceeded =>
        Results.StatusCode(507),  // 507 Insufficient Storage

    StorageErrorCode.VirusScanFailed =>
        Results.UnprocessableEntity(new { threat = result.ErrorMessage }),

    StorageErrorCode.Duplicate =>
        // DeduplicationMiddleware: the file already exists; ErrorMessage contains the existing URL
        Results.Ok(new { duplicate = true, url = result.ErrorMessage }),

    StorageErrorCode.Conflict =>
        Results.Conflict(new { error = "A file already exists at this path." }),

    StorageErrorCode.ProviderError =>
        Results.StatusCode(503),

    _ =>
        Results.Problem(result.ErrorMessage, statusCode: 500)
};
```

---

## Pattern Matching

C# pattern matching integrates cleanly with `StorageResult`:

```csharp
var result = await provider.GetMetadataAsync("uploads/report.pdf");

var response = result switch
{
    { IsSuccess: true }                              => Results.Ok(result.Value),
    { ErrorCode: StorageErrorCode.FileNotFound }     => Results.NotFound(),
    { ErrorCode: StorageErrorCode.AccessDenied }     => Results.Forbid(),
    { ErrorCode: StorageErrorCode.ProviderError }    => Results.StatusCode(503),
    _                                                => Results.Problem(result.ErrorMessage)
};
```

---

## Functional Chaining

ValiBlob provides extension methods for composing result-returning operations without nested `if` blocks:

### MapAsync — transform the success value

```csharp
// Transform UploadResult into just the URL string
StorageResult<string> urlResult = await provider
    .UploadAsync(request)
    .MapAsync(uploadResult => uploadResult.Url);

Console.WriteLine(urlResult.IsSuccess ? urlResult.Value : urlResult.ErrorMessage);
```

### BindAsync — chain a dependent async operation

```csharp
// Upload, then immediately fetch metadata — both must succeed
StorageResult<FileMetadata> metaResult = await provider
    .UploadAsync(request)
    .BindAsync(upload => provider.GetMetadataAsync(upload.Path));
```

### OnSuccessAsync — side-effect on success only

```csharp
await provider.UploadAsync(request)
    .OnSuccessAsync(r => _eventBus.PublishAsync(new FileUploadedEvent(r.Path, r.Url)));
```

### OnFailureAsync — side-effect on failure only

```csharp
await provider.DeleteAsync("uploads/old.zip")
    .OnFailureAsync(r => _logger.LogWarning(
        "Delete failed [{Code}]: {Msg}", r.ErrorCode, r.ErrorMessage));
```

### Combining chains

```csharp
var finalResult = await provider.UploadAsync(request)
    .OnSuccessAsync(r => auditLog.RecordAsync(r.Path, r.Url))
    .OnFailureAsync(r => metrics.IncrementAsync("upload.failures", r.ErrorCode.ToString()))
    .MapAsync(r => r.Url);

if (finalResult.IsSuccess)
    return Results.Ok(new { url = finalResult.Value });

return Results.Problem(finalResult.ErrorMessage);
```

---

## Manual Chaining (without extensions)

When you prefer explicit early returns:

```csharp
var uploadResult = await provider.UploadAsync(request);

if (!uploadResult.IsSuccess)
{
    return uploadResult.ErrorCode switch
    {
        StorageErrorCode.ValidationFailed => Results.BadRequest(uploadResult.ErrorMessage),
        _                                 => Results.Problem(uploadResult.ErrorMessage)
    };
}

// Safe: IsSuccess is true, Value is non-null
var metaResult = await provider.GetMetadataAsync(uploadResult.Value.Path);

if (!metaResult.IsSuccess)
    return Results.Problem(metaResult.ErrorMessage);

return Results.Ok(new
{
    url  = uploadResult.Value.Url,
    size = metaResult.Value.SizeBytes,
    type = metaResult.Value.ContentType
});
```

---

## Unwrapping with Exceptions (Optional)

If you prefer exception-based flow in specific scenarios, use the `GetValueOrThrow()` extension:

```csharp
// Throws StorageException (containing ErrorCode and ErrorMessage) if IsFailure
var uploadResult = (await provider.UploadAsync(request)).GetValueOrThrow();
Console.WriteLine(uploadResult.Url);
```

`StorageException` carries `ErrorCode` and `ErrorMessage` from the original result, so you can catch and inspect it:

```csharp
try
{
    var result = (await provider.UploadAsync(request)).GetValueOrThrow();
    return Results.Ok(result.Url);
}
catch (StorageException ex) when (ex.ErrorCode == StorageErrorCode.QuotaExceeded)
{
    return Results.StatusCode(507);
}
```

:::warning Use GetValueOrThrow sparingly
`GetValueOrThrow()` defeats the purpose of the result pattern at library boundaries. It is most appropriate in application-level code where a global exception handler will convert the exception to an HTTP response, or inside tests where exceptions are more convenient to assert.
:::

---

## Using Results in ASP.NET Core — Helper Extension

A reusable extension for mapping `StorageResult<T>` to `IResult`:

```csharp
public static class StorageResultExtensions
{
    public static IResult ToHttpResult<T>(this StorageResult<T> result)
        where T : class
    {
        if (result.IsSuccess) return Results.Ok(result.Value);

        return result.ErrorCode switch
        {
            StorageErrorCode.FileNotFound     => Results.NotFound(),
            StorageErrorCode.AccessDenied     => Results.Forbid(),
            StorageErrorCode.ValidationFailed => Results.BadRequest(result.ErrorMessage),
            StorageErrorCode.QuotaExceeded    => Results.StatusCode(507),
            StorageErrorCode.VirusScanFailed  => Results.UnprocessableEntity(result.ErrorMessage),
            StorageErrorCode.Conflict         => Results.Conflict(),
            StorageErrorCode.Duplicate        => Results.Ok(new { duplicate = true, url = result.ErrorMessage }),
            _                                 => Results.Problem(result.ErrorMessage)
        };
    }
}

// Usage in minimal API:
app.MapGet("/files/{*path}", async (string path, IStorageFactory factory) =>
    (await factory.Create().DownloadAsync(new DownloadRequest { Path = path }))
        .ToHttpResult()
);
```

---

## Checking Void Operations

`StorageResult` (non-generic) is used for operations with no meaningful return value:

```csharp
// Delete
var deleteResult = await provider.DeleteAsync("uploads/photo.jpg");
if (!deleteResult.IsSuccess)
    _logger.LogError("Delete failed [{Code}]: {Msg}", deleteResult.ErrorCode, deleteResult.ErrorMessage);

// Copy
var copyResult = await provider.CopyAsync("uploads/original.pdf", "backups/copy.pdf");
if (!copyResult.IsSuccess)
    throw new InvalidOperationException($"Backup copy failed: {copyResult.ErrorMessage}");

// SetMetadata
var metaResult = await provider.SetMetadataAsync("uploads/file.pdf", new Dictionary<string, string>
{
    ["reviewed"] = "true",
    ["reviewer"] = "alice"
});
Console.WriteLine(metaResult.IsSuccess ? "Metadata updated." : $"Failed: {metaResult.ErrorMessage}");
```

---

## Related

- [Upload](./upload.md) — `UploadResult` fields
- [Download](./download.md) — `DownloadRequest` and streaming
- [Pipeline Overview](../pipeline/overview.md) — How middleware errors become `StorageResult.Failure`
- [StoragePath](./storage-path.md) — Safe path building
