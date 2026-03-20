---
title: Testing
sidebar_label: Testing
sidebar_position: 8
---

# Testing

`ValiBlob.Testing` provides `InMemoryStorageProvider`, a fully functional in-memory implementation of `IStorageProvider` and `IResumableUploadProvider`. It stores files in a `ConcurrentDictionary` and supports all standard operations — making it straightforward to write unit and integration tests without connecting to a real cloud provider.

---

## Installation

```bash
dotnet add package ValiBlob.Testing
```

---

## How It Works

```csharp
// Simplified internal structure
public class InMemoryStorageProvider : IStorageProvider, IResumableUploadProvider
{
    // All uploaded files
    private readonly ConcurrentDictionary<string, InMemoryFile> _files = new();

    // In-progress resumable sessions
    private readonly ConcurrentDictionary<string, InMemoryUploadSession> _sessions = new();
}

public class InMemoryFile
{
    public byte[]                     Content     { get; init; } = [];
    public string?                    ContentType { get; init; }
    public long                       SizeBytes   => Content.LongLength;
    public DateTimeOffset             UploadedAt  { get; init; }
    public Dictionary<string, string> CustomMetadata { get; init; } = new();
    public string                     ETag        { get; init; } = Guid.NewGuid().ToString("N");
}
```

Files exist only in heap memory — they do not survive process restarts. Each test class or method can start with a clean `InMemoryStorageProvider` instance.

---

## Basic Usage (Without DI)

```csharp
using ValiBlob.Testing;

var provider = new InMemoryStorageProvider();

// Upload
await using var stream = new MemoryStream("Hello, ValiBlob!"u8.ToArray());
var upload = await provider.UploadAsync(new UploadRequest
{
    Path        = StoragePath.From("test", "greeting.txt"),
    Content     = stream,
    ContentType = "text/plain"
});

// Download
var download = await provider.DownloadAsync("test/greeting.txt");
using var reader  = new StreamReader(download.Value);
var content = await reader.ReadToEndAsync();
// content == "Hello, ValiBlob!"

// Exists
var exists = await provider.ExistsAsync("test/greeting.txt");
// exists.Value == true

// Delete
await provider.DeleteAsync("test/greeting.txt");
```

---

## DI Registration

```csharp
// Test project WebApplicationFactory or DI setup
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "test")
    .AddInMemoryProvider("test");
```

To replace a real provider registered by your application:

```csharp
// In WebApplicationFactory.ConfigureWebHost:
builder.ConfigureServices(services =>
{
    // Remove the real S3 provider
    var realProvider = services.SingleOrDefault(
        d => d.ServiceKey is "aws");
    if (realProvider is not null)
        services.Remove(realProvider);

    // Register InMemory in its place
    services
        .AddValiBlob()
        .AddInMemoryProvider("aws");
});
```

---

## xUnit Unit Tests

```csharp
using ValiBlob.Core;
using ValiBlob.Testing;
using Xunit;

public class FileServiceTests : IDisposable
{
    private readonly InMemoryStorageProvider _storage;
    private readonly FileService             _sut;

    public FileServiceTests()
    {
        _storage = new InMemoryStorageProvider();
        _sut     = new FileService(_storage);
    }

    public void Dispose() => _storage.Clear();

    [Fact]
    public async Task UploadAndDownload_ReturnsOriginalContent()
    {
        var original = "Hello from test!"u8.ToArray();
        await using var stream = new MemoryStream(original);

        await _storage.UploadAsync(new UploadRequest
        {
            Path        = StoragePath.From("test", "hello.txt"),
            Content     = stream,
            ContentType = "text/plain"
        });

        var result = await _storage.DownloadAsync("test/hello.txt");

        Assert.True(result.IsSuccess);
        var downloaded = await new StreamReader(result.Value).ReadToEndAsync();
        Assert.Equal("Hello from test!", downloaded);
    }

    [Fact]
    public async Task Delete_RemovesFile()
    {
        await UploadTestFile("test/file.bin");

        await _storage.DeleteAsync("test/file.bin");

        var exists = await _storage.ExistsAsync("test/file.bin");
        Assert.True(exists.IsSuccess);
        Assert.False(exists.Value);
    }

    [Fact]
    public async Task ListFilesAsync_ReturnsOnlyMatchingPrefix()
    {
        await UploadTestFile("images/a.jpg");
        await UploadTestFile("images/b.jpg");
        await UploadTestFile("documents/c.pdf");

        var result = await _storage.ListFilesAsync("images/");

        Assert.True(result.IsSuccess);
        var files = result.Value.ToList();
        Assert.Equal(2, files.Count);
        Assert.All(files, f => Assert.StartsWith("images/", f.Path));
    }

    [Fact]
    public async Task GetMetadataAsync_ReturnsCorrectContentType()
    {
        await using var stream = new MemoryStream([0xFF, 0xD8, 0xFF]);
        await _storage.UploadAsync(new UploadRequest
        {
            Path        = StoragePath.From("photo.jpg"),
            Content     = stream,
            ContentType = "image/jpeg"
        });

        var meta = await _storage.GetMetadataAsync("photo.jpg");

        Assert.True(meta.IsSuccess);
        Assert.Equal("image/jpeg", meta.Value.ContentType);
        Assert.Equal(3L, meta.Value.SizeBytes);
    }

    [Fact]
    public async Task CustomMetadata_RoundTrips()
    {
        await using var stream = new MemoryStream(new byte[100]);
        await _storage.UploadAsync(new UploadRequest
        {
            Path           = StoragePath.From("avatars", "user-42.jpg"),
            Content        = stream,
            ContentType    = "image/jpeg",
            CustomMetadata = new Dictionary<string, string>
            {
                ["x-user-id"]       = "42",
                ["x-original-name"] = "profile.jpg"
            }
        });

        var meta = await _storage.GetMetadataAsync("avatars/user-42.jpg");

        Assert.Equal("42",          meta.Value.CustomMetadata["x-user-id"]);
        Assert.Equal("profile.jpg", meta.Value.CustomMetadata["x-original-name"]);
    }

    private async Task UploadTestFile(string path)
    {
        await using var stream = new MemoryStream([1, 2, 3]);
        await _storage.UploadAsync(new UploadRequest
        {
            Path        = StoragePath.From(path),
            Content     = stream,
            ContentType = "application/octet-stream"
        });
    }
}
```

---

## Testing Resumable Uploads

`InMemoryStorageProvider` implements `IResumableUploadProvider`:

```csharp
[Fact]
public async Task ResumableUpload_AssemblesChunksCorrectly()
{
    var provider  = new InMemoryStorageProvider();
    var resumable = (IResumableUploadProvider)provider;

    // 15 bytes uploaded in 3 chunks of 5 bytes each
    var totalData = "Hello, World!!!"u8.ToArray();
    const int chunkSize = 5;

    // Step 1: Start session
    var start = await resumable.StartResumableUploadAsync(new StartResumableUploadRequest
    {
        Path        = StoragePath.From("test", "chunked.txt"),
        TotalSize   = totalData.Length,
        ContentType = "text/plain"
    });
    Assert.True(start.IsSuccess);
    var uploadId = start.Value.UploadId;

    // Step 2: Upload chunks
    long offset = 0;
    while (offset < totalData.Length)
    {
        var length = (int)Math.Min(chunkSize, totalData.Length - offset);
        var chunk  = new ReadOnlyMemory<byte>(totalData, (int)offset, length);

        var chunkResult = await resumable.UploadChunkAsync(new UploadChunkRequest
        {
            UploadId = uploadId,
            Chunk    = chunk,
            Offset   = offset
        });
        Assert.True(chunkResult.IsSuccess);
        offset = chunkResult.Value.NextOffset;
    }

    // Step 3: Complete
    var complete = await resumable.CompleteResumableUploadAsync(uploadId);
    Assert.True(complete.IsSuccess);

    // Verify assembled file
    var download = await provider.DownloadAsync("test/chunked.txt");
    Assert.True(download.IsSuccess);
    var content = await new StreamReader(download.Value).ReadToEndAsync();
    Assert.Equal("Hello, World!!!", content);
}
```

---

## Testing Pipeline Middleware

Test that your pipeline configuration produces the expected result using the in-memory provider:

```csharp
[Fact]
public async Task ValidationMiddleware_RejectsOversizedFiles()
{
    var storage = new InMemoryStorageProvider();

    var pipeline = new ValiBloBPipelineBuilder()
        .UseValidation(v => v.MaxFileSizeBytes = 100)
        .Build(storage);

    var largeContent = new byte[200]; // 200 bytes > 100 byte limit
    await using var stream = new MemoryStream(largeContent);

    var result = await pipeline.UploadAsync(new UploadRequest
    {
        Path        = StoragePath.From("large-file.bin"),
        Content     = stream,
        ContentType = "application/octet-stream"
    });

    Assert.False(result.IsSuccess);
    Assert.Equal(StorageErrorCode.ValidationFailed, result.ErrorCode);
    Assert.Contains("exceeds", result.ErrorMessage, StringComparison.OrdinalIgnoreCase);
}

[Fact]
public async Task ConflictResolution_ReplaceExisting_OverwritesFile()
{
    var storage = new InMemoryStorageProvider();

    var pipeline = new ValiBloBPipelineBuilder()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
        .Build(storage);

    // First upload
    await using var stream1 = new MemoryStream("version1"u8.ToArray());
    await pipeline.UploadAsync(new UploadRequest
    {
        Path    = StoragePath.From("file.txt"),
        Content = stream1
    });

    // Second upload — same path, different content
    await using var stream2 = new MemoryStream("version2"u8.ToArray());
    var result = await pipeline.UploadAsync(new UploadRequest
    {
        Path    = StoragePath.From("file.txt"),
        Content = stream2
    });

    Assert.True(result.IsSuccess);

    var download = await storage.DownloadAsync("file.txt");
    var content  = await new StreamReader(download.Value).ReadToEndAsync();
    Assert.Equal("version2", content);
}
```

---

## Accessing Internal State

`InMemoryStorageProvider` exposes its internal store for direct test assertions:

```csharp
var provider = new InMemoryStorageProvider();
await UploadTestFiles(provider);

// Direct access to stored files (bypasses the IStorageProvider API)
var allFiles = provider.GetAllFiles();
Assert.Equal(3, allFiles.Count);

var file = allFiles["images/avatar.jpg"];
Assert.Equal("image/jpeg",  file.ContentType);
Assert.Equal(1024L,         file.SizeBytes);

// Clear between test cases
provider.Clear();
Assert.Empty(provider.GetAllFiles());
```

---

## ASP.NET Core Integration Tests

Use `WebApplicationFactory<TProgram>` to replace real providers with in-memory:

```csharp
using Microsoft.AspNetCore.Mvc.Testing;

public class UploadApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public UploadApiTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Remove the real AWS provider
                var real = services.SingleOrDefault(d => d.ServiceKey is "aws");
                if (real is not null) services.Remove(real);

                // Replace with in-memory
                services
                    .AddValiBlob()
                    .AddInMemoryProvider("aws");
            });
        });
    }

    [Fact]
    public async Task PostFile_Returns200AndFileIsStored()
    {
        var client = _factory.CreateClient();

        using var content = new MultipartFormDataContent();
        content.Add(
            new ByteArrayContent("test file content"u8.ToArray()),
            "file", "test.txt");

        var response = await client.PostAsync("/api/upload", content);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // Verify via the in-memory store
        var storage  = _factory.Services.GetKeyedService<IStorageProvider>("aws")
            as InMemoryStorageProvider;
        Assert.NotNull(storage);
        Assert.NotEmpty(storage!.GetAllFiles());
    }

    [Fact]
    public async Task PostFile_WithBlockedExtension_Returns400()
    {
        var client = _factory.CreateClient();

        using var content = new MultipartFormDataContent();
        content.Add(
            new ByteArrayContent(new byte[100]),
            "file", "malware.exe");

        var response = await client.PostAsync("/api/upload", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

---

## Testing Event Handlers

When your application raises `IStorageEventHandler<T>` events after upload, mock the handler and verify it was called:

```csharp
using NSubstitute;

[Fact]
public async Task UploadService_PublishesFileUploadedEvent()
{
    var storage  = new InMemoryStorageProvider();
    var handler  = Substitute.For<IStorageEventHandler<FileUploadedEvent>>();
    var sut      = new UploadService(storage, handler);

    await sut.UploadAsync("folder/file.txt", "content"u8.ToArray(), "text/plain");

    await handler.Received(1).HandleAsync(
        Arg.Is<FileUploadedEvent>(e => e.Path == "folder/file.txt"),
        Arg.Any<CancellationToken>());
}
```

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | Full support |
| `DownloadAsync` | Yes | Including `DownloadRange` |
| `DeleteAsync` | Yes | |
| `DeleteFolderAsync` | Yes | |
| `ExistsAsync` | Yes | |
| `CopyAsync` | Yes | |
| `GetMetadataAsync` | Yes | Including `CustomMetadata` |
| `SetMetadataAsync` | Yes | |
| `ListFilesAsync` | Yes | Prefix filtering |
| `ListFoldersAsync` | Yes | |
| `StartResumableUploadAsync` | Yes | In-memory chunk assembly |
| `UploadChunkAsync` | Yes | |
| `CompleteResumableUploadAsync` | Yes | |
| `AbortResumableUploadAsync` | Yes | |
| `GetPresignedUploadUrlAsync` | No | Not applicable for in-memory |
| `GetPresignedDownloadUrlAsync` | No | Not applicable for in-memory |
| Persistence across restarts | No | In-memory only |
| Thread-safe concurrent access | Yes | `ConcurrentDictionary` |

---

## Related

- [Packages](../packages.md) — ValiBlob package reference
- [Storage Result](../core/storage-result.md) — Result/error pattern in tests
- [Pipeline Overview](../pipeline/overview.md) — Testing middleware configurations
- [Resumable Uploads](../resumable/overview.md) — Testing the three-step upload flow
