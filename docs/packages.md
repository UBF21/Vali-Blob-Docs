---
id: packages
title: Packages Reference
sidebar_label: Packages
---

# Packages Reference

ValiBlob is distributed as a family of 12 focused NuGet packages. Install only what your project needs. All packages target **net8.0** and **net9.0** and are versioned together — always use the same version across all ValiBlob packages in a project.

---

## Summary Table

| Package | Required | Cloud Dependency | Supports Resumable | Supports Presigned URLs |
|---|---|---|---|---|
| `ValiBlob.Core` | Always | None | — | — |
| `ValiBlob.AWS` | When using S3 | AWSSDK.S3 | Yes | Yes |
| `ValiBlob.Azure` | When using Azure | Azure.Storage.Blobs | Yes | Yes (SAS tokens) |
| `ValiBlob.GCP` | When using GCP | Google.Cloud.Storage.V1 | Yes | Yes (V4 signed URLs) |
| `ValiBlob.OCI` | When using OCI | Oracle SDK | Yes | Yes (PARs via API) |
| `ValiBlob.Supabase` | When using Supabase | supabase-csharp | No | Yes |
| `ValiBlob.Local` | For local/dev | None | Yes | Yes (HTTP) |
| `ValiBlob.Redis` | For Redis sessions | StackExchange.Redis | Session Store | — |
| `ValiBlob.EFCore` | For DB sessions | EF Core | Session Store | — |
| `ValiBlob.Testing` | In test projects | None | Yes | Yes |
| `ValiBlob.HealthChecks` | For health endpoints | ASP.NET Core | — | — |
| `ValiBlob.ImageSharp` | For image processing | SixLabors.ImageSharp | — | — |

---

## ValiBlob.Core

The foundation package. Every ValiBlob project requires this package.

```bash
dotnet add package ValiBlob.Core
```

**What it provides:**

- `IStorageProvider` — the core storage interface with 11 operations
- `IStorageFactory` — resolves named providers by key
- `BaseStorageProvider` — base class with pipeline execution, resilience hooks, and telemetry
- `StorageResult<T>` / `StorageResult` — explicit result/error pattern, no exceptions for expected failures
- `StoragePath` — safe path building with date/hash/random suffixes and sanitization
- `StorageErrorCode` — enum of all well-known error conditions
- `StoragePipelineBuilder` — fluent middleware registration
- DI extension methods: `AddValiBlob()`, `AddProvider<T>()`, `WithPipeline()`
- `IResumableUploadProvider` — optional interface for resumable upload support
- `IPresignedUrlProvider` — optional interface for presigned URL generation
- All request/response types: `UploadRequest`, `DownloadRequest`, `FileMetadata`, `FileEntry`, `UploadResult`
- Event system: `IStorageEventHandler<T>`, `StorageEventContext`

**Key dependencies:**

| Dependency | Purpose |
|---|---|
| `Microsoft.Extensions.DependencyInjection.Abstractions` | DI integration |
| `Microsoft.Extensions.Options` | Options pattern |
| `Microsoft.Extensions.Logging.Abstractions` | Structured logging |

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Required | Yes — always install this |
| External cloud dependency | None |

---

## ValiBlob.AWS

Amazon S3 provider implementation.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.AWS
```

**What it provides:**

- `AWSS3Provider` — full `IStorageProvider` + `IResumableUploadProvider` + `IPresignedUrlProvider` implementation
- `AWSS3Options` — provider configuration:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts =>
    {
        opts.BucketName  = "my-bucket";
        opts.Region      = "us-east-1";
        opts.AccessKey   = config["AWS:AccessKey"]!;
        opts.SecretKey   = config["AWS:SecretKey"]!;
        opts.ServiceUrl  = null; // set to "http://localhost:4566" for LocalStack
    });
```

**AWSS3Options fields:**

| Field | Type | Description |
|---|---|---|
| `BucketName` | `string` | S3 bucket name |
| `Region` | `string` | AWS region code (e.g., `us-east-1`) |
| `AccessKey` | `string?` | AWS access key (leave null to use IAM role) |
| `SecretKey` | `string?` | AWS secret key (leave null to use IAM role) |
| `ServiceUrl` | `string?` | Override endpoint URL (for LocalStack, MinIO, etc.) |
| `ForcePathStyle` | `bool` | Use path-style URLs instead of virtual-hosted; required for LocalStack |

**Key dependency:** `AWSSDK.S3`

:::tip IAM Roles
In production on AWS (EC2, ECS, Lambda), do not set `AccessKey` and `SecretKey`. Leave them null and grant the instance/task IAM role the necessary S3 permissions. This is more secure and eliminates credential rotation.
:::

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | Yes (S3 multipart upload) |
| Supports presigned URLs | Yes |

---

## ValiBlob.Azure

Azure Blob Storage provider implementation.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Azure
```

**What it provides:**

- `AzureBlobProvider` — full `IStorageProvider` + `IResumableUploadProvider` + `IPresignedUrlProvider`
- `AzureBlobOptions`:

```csharp
.AddProvider<AzureBlobProvider>("azure", opts =>
{
    opts.ConnectionString = config["Azure:ConnectionString"]!;
    opts.ContainerName    = "my-container";
})
```

**AzureBlobOptions fields:**

| Field | Type | Description |
|---|---|---|
| `ConnectionString` | `string` | Azure Storage connection string |
| `ContainerName` | `string` | Blob container name |
| `CreateContainerIfNotExists` | `bool` | Auto-create the container on startup (default: `false`) |

**Key dependency:** `Azure.Storage.Blobs`

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | Yes (block blob uncommitted blocks) |
| Supports presigned URLs | Yes (SAS tokens) |

---

## ValiBlob.GCP

Google Cloud Storage provider implementation.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.GCP
```

**What it provides:**

- `GCPStorageProvider` — full `IStorageProvider` + `IResumableUploadProvider` + `IPresignedUrlProvider`
- `GCPStorageOptions`:

```csharp
.AddProvider<GCPStorageProvider>("gcp", opts =>
{
    opts.ProjectId       = config["GCP:ProjectId"]!;
    opts.BucketName      = config["GCP:BucketName"]!;
    opts.JsonCredentials = File.ReadAllText("/secrets/gcp-sa.json");
})
```

**GCPStorageOptions fields:**

| Field | Type | Description |
|---|---|---|
| `ProjectId` | `string` | Google Cloud project ID |
| `BucketName` | `string` | GCS bucket name |
| `JsonCredentials` | `string?` | Service account JSON (leave null to use Application Default Credentials) |

**Key dependency:** `Google.Cloud.Storage.V1`

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | Yes (GCS resumable upload sessions) |
| Supports presigned URLs | Yes (V4 signed URLs) |

---

## ValiBlob.OCI

Oracle Cloud Infrastructure Object Storage provider.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.OCI
```

**What it provides:**

- `OCIStorageProvider` — `IStorageProvider` + `IResumableUploadProvider`
- `OCIStorageOptions` — OCI tenancy OCID, region, bucket, and API key configuration

**OCIStorageOptions fields:**

| Field | Type | Description |
|---|---|---|
| `TenancyId` | `string` | OCI tenancy OCID |
| `UserId` | `string` | OCI user OCID |
| `Fingerprint` | `string` | API key fingerprint |
| `PrivateKey` | `string` | PEM-encoded private key content |
| `Region` | `string` | OCI region identifier (e.g., `us-ashburn-1`) |
| `BucketName` | `string` | Object Storage bucket name |
| `Namespace` | `string` | Object Storage namespace |

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | Yes (OCI multipart uploads) |
| Supports presigned URLs | Yes — via OCI Pre-Authenticated Requests (PARs). Unlike AWS/GCP, each URL requires an API call to OCI (no local signing). |

---

## ValiBlob.Supabase

Supabase Storage provider implementation.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Supabase
```

**What it provides:**

- `SupabaseStorageProvider` — `IStorageProvider` + `IPresignedUrlProvider`
- `SupabaseStorageOptions`:

```csharp
.AddProvider<SupabaseStorageProvider>("supabase", opts =>
{
    opts.Url        = config["Supabase:Url"]!;          // https://xyz.supabase.co
    opts.ServiceKey = config["Supabase:ServiceKey"]!;   // service_role key
    opts.BucketName = "user-uploads";
})
```

**Key dependency:** `supabase-csharp`

:::info Resumable uploads with Supabase
`SupabaseStorageProvider` does not implement `IResumableUploadProvider` natively. For resumable uploads with Supabase, use ValiBlob's own chunking layer by storing session state in Redis or EF Core and pointing the resumable upload endpoint at the Supabase provider.
:::

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | No (use ValiBlob chunking layer) |
| Supports presigned URLs | Yes (signed URLs) |

---

## ValiBlob.Local

Local filesystem storage provider for development and on-premise deployments.

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Local
```

**What it provides:**

- `LocalStorageProvider` — `IStorageProvider` + `IResumableUploadProvider` + `IPresignedUrlProvider`
- `LocalStorageOptions`:

```csharp
.AddProvider<LocalStorageProvider>("local", opts =>
{
    opts.BasePath            = Path.Combine(builder.Environment.ContentRootPath, "storage");
    opts.CreateIfNotExists   = true;
    opts.PublicBaseUrl       = "https://localhost:5001/storage";
})
```

- Metadata stored as `.meta.json` sidecar files alongside each stored object
- Resumable uploads via chunk staging directories under `BasePath/.chunks/`
- Presigned URLs are signed HTTP URLs pointing to a local static files endpoint

**LocalStorageOptions fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `BasePath` | `string` | Required | Root directory for all stored files |
| `CreateIfNotExists` | `bool` | `false` | Create `BasePath` if it does not exist |
| `PublicBaseUrl` | `string?` | `null` | Base URL for generating public file URLs |

**Key dependency:** None (pure .NET, no external SDK)

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supports resumable uploads | Yes |
| Supports presigned URLs | Yes (local HTTP signed URLs) |
| External cloud dependency | None |

---

## ValiBlob.Redis

Redis-backed resumable upload session store.

```bash
dotnet add package ValiBlob.Redis
```

**What it provides:**

- `RedisResumableSessionStore` — implements `IResumableSessionStore`
- `RedisSessionStoreOptions` — connection string, key prefix, and TTL
- `AddRedisSessionStore()` DI extension

```csharp
builder.Services
    .AddValiBlob(...)
    .AddRedisSessionStore(opts =>
    {
        opts.ConnectionString = config["Redis:ConnectionString"]!;
        opts.KeyPrefix        = "valiblob:sessions:";
        opts.Ttl              = TimeSpan.FromHours(24);
    });
```

**When to use:** Horizontally scaled applications (multiple instances) where resumable upload sessions must survive load balancer routing to different instances. Redis provides fast, shared session state with automatic expiry.

**Key dependency:** `StackExchange.Redis`

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Minimum Redis version | 6.0 |
| Session expiry | Configurable TTL (default: 24 hours) |

---

## ValiBlob.EFCore

Entity Framework Core resumable upload session store.

```bash
dotnet add package ValiBlob.EFCore
```

**What it provides:**

- `EfCoreResumableSessionStore` — implements `IResumableSessionStore`
- `ResumableSessionDbContext` — EF Core `DbContext` with `ResumableSessions` table
- `AddEfCoreSessionStore<TContext>()` DI extension
- EF Core migration support

```csharp
// Register with your existing DbContext
builder.Services
    .AddValiBlob(...)
    .AddEfCoreSessionStore<AppDbContext>();

// Or with the built-in standalone context
builder.Services
    .AddDbContext<ResumableSessionDbContext>(o =>
        o.UseNpgsql(config.GetConnectionString("Default")))
    .AddEfCoreSessionStore<ResumableSessionDbContext>();
```

Apply the migration to create the sessions table:

```bash
dotnet ef migrations add AddResumableSessions
dotnet ef database update
```

**When to use:** Applications that already use EF Core and want sessions persisted to their existing relational database, with no need for a Redis cluster.

**Key dependency:** `Microsoft.EntityFrameworkCore`

**Supported databases:** PostgreSQL, MySQL, SQL Server, SQLite, and any EF Core provider.

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Requires migration | Yes |
| Supported databases | Any EF Core provider |

---

## ValiBlob.Testing

In-memory storage provider for unit and integration tests.

```bash
dotnet add package ValiBlob.Testing
```

**What it provides:**

- `InMemoryStorageProvider` — in-process, dictionary-backed implementation of `IStorageProvider` and `IResumableUploadProvider`
- Pre-seeding helpers for test setup:

```csharp
var provider = new InMemoryStorageProvider();

// Seed a file with content
provider.Seed("uploads/avatar.jpg", Encoding.UTF8.GetBytes("fake-image-bytes"));

// Seed metadata
provider.SeedMetadata("uploads/avatar.jpg", new FileMetadata
{
    SizeBytes   = 1024,
    ContentType = "image/jpeg"
});
```

- Inspection helpers for assertions:

```csharp
// Assert file was uploaded
Assert.True(provider.Contains("uploads/avatar.jpg"));

// Assert file content
var bytes = provider.GetBytes("uploads/avatar.jpg");
Assert.Equal(expectedBytes, bytes);

// Get all stored paths
var allPaths = provider.GetAll().Select(e => e.Path);
```

**When to use:** Every test project. The in-memory provider is deterministic, instantaneous, and requires no infrastructure. Inject it via DI using `AddValiBlob().AddProvider<InMemoryStorageProvider>("test")`.

:::tip Test isolation
Create a new `InMemoryStorageProvider` instance per test (or test class) to prevent state leakage between tests.
:::

**Key dependency:** None (ValiBlob.Core only)

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Thread-safe | Yes |
| For production use | No — test projects only |

---

## ValiBlob.HealthChecks

ASP.NET Core health check integration for storage providers.

```bash
dotnet add package ValiBlob.HealthChecks
```

**What it provides:**

- `ValiBloBHealthCheck` — implements `IHealthCheck`, probes a provider by calling `ExistsAsync` on a canary path
- `AddValiBlob()` extension on `IHealthChecksBuilder`

```csharp
builder.Services
    .AddHealthChecks()
    .AddValiBlob("aws-storage",
        provider: serviceProvider => serviceProvider
            .GetRequiredService<IStorageFactory>().Create("aws"),
        failureStatus: HealthStatus.Unhealthy,
        tags: ["storage", "aws"]);

app.MapHealthChecks("/health");
```

**When to use:** Any production ASP.NET Core application. Expose storage provider health via `/health` for Kubernetes liveness/readiness probes, uptime monitors, or operations dashboards.

**Key dependency:** `Microsoft.Extensions.Diagnostics.HealthChecks`

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| ASP.NET Core version | 8.0+ |

---

## ValiBlob.ImageSharp

Image processing pipeline middleware using SixLabors.ImageSharp.

```bash
dotnet add package ValiBlob.ImageSharp
```

**What it provides:**

- `ImageProcessingMiddleware` — upload-time image resize, format conversion, and thumbnail generation
- `ImageProcessingOptions` — processing configuration
- `UseImageProcessing()` pipeline extension method

```csharp
.WithPipeline(p => p
    .UseValidation(v => v.AllowedExtensions = [".jpg", ".png", ".webp"])
    .UseImageProcessing(img =>
    {
        img.ResizeWidth       = 1280;
        img.ResizeHeight      = 720;
        img.OutputFormat      = ImageFormat.WebP;
        img.Quality           = 85;
        img.GenerateThumbnail = true;
        img.ThumbnailWidth    = 200;
        img.ThumbnailHeight   = 200;
    })
    .UseConflictResolution(ConflictResolution.ReplaceExisting)
)
```

**ImageProcessingOptions fields:**

| Field | Type | Default | Description |
|---|---|---|---|
| `ResizeWidth` | `int?` | `null` | Target width in pixels (null = no resize) |
| `ResizeHeight` | `int?` | `null` | Target height in pixels (null = no resize) |
| `OutputFormat` | `ImageFormat?` | `null` | Convert to this format (null = keep original) |
| `Quality` | `int` | `85` | JPEG/WebP quality (1–100) |
| `GenerateThumbnail` | `bool` | `false` | Also store a thumbnail |
| `ThumbnailWidth` | `int` | `200` | Thumbnail width in pixels |
| `ThumbnailHeight` | `int` | `200` | Thumbnail height in pixels |

| Property | Value |
|---|---|
| Target frameworks | net8.0; net9.0 |
| Supported input formats | JPEG, PNG, GIF, BMP, TIFF, WebP |
| Supported output formats | JPEG, PNG, WebP, AVIF |
| Key dependency | `SixLabors.ImageSharp` |
