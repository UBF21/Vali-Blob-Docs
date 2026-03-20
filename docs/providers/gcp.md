---
title: Google Cloud Storage Provider
sidebar_label: Google Cloud Storage
sidebar_position: 3
---

# Google Cloud Storage Provider

`ValiBlob.GCP` provides `GCPStorageProvider`, implementing `IStorageProvider`, `IResumableUploadProvider`, and `IPresignedUrlProvider` backed by Google Cloud Storage (GCS) via `Google.Cloud.Storage.V1`.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.GCP
```

---

## GCPStorageOptions Reference

| Option | Type | Required | Description |
|---|---|---|---|
| `ProjectId` | `string` | Yes | GCP project ID, e.g. `"my-project-12345"`. |
| `BucketName` | `string` | Yes | GCS bucket name for all operations. |
| `JsonCredentials` | `string?` | No | Service account key JSON as a string. Omit to use Application Default Credentials (ADC). |
| `DefaultStorageClass` | `string?` | No | Default storage class: `"STANDARD"`, `"NEARLINE"`, `"COLDLINE"`, `"ARCHIVE"`. Default: `null` (bucket default). |

---

## DI Registration

### With Service Account Key

```csharp
using ValiBlob.Core;
using ValiBlob.GCP;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcp")
    .AddProvider<GCPStorageProvider>("gcp", opts =>
    {
        opts.ProjectId       = builder.Configuration["GCP:ProjectId"]!;
        opts.BucketName      = builder.Configuration["GCP:BucketName"]!;
        opts.JsonCredentials = builder.Configuration["GCP:ServiceAccountJson"]!;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes  = 500_000_000;
            v.AllowedExtensions = [".jpg", ".png", ".pdf", ".mp4"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );
```

### appsettings.json

```json
{
  "GCP": {
    "ProjectId": "my-project-12345",
    "BucketName": "my-app-uploads"
  }
}
```

:::warning Never commit service account keys
Store the JSON key in `dotnet user-secrets` for development, or load it from an environment variable or secret manager. Never commit `.json` key files to source control.
:::

---

## Application Default Credentials (ADC)

When running on GCP (GKE, Cloud Run, Compute Engine, App Engine), use Application Default Credentials instead of a service account key file. ADC resolves credentials automatically from the runtime environment:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcp")
    .AddProvider<GCPStorageProvider>("gcp", opts =>
    {
        opts.ProjectId  = builder.Configuration["GCP:ProjectId"]!;
        opts.BucketName = builder.Configuration["GCP:BucketName"]!;
        // JsonCredentials omitted — ADC used automatically
    });
```

For local development with ADC, authenticate with the gcloud CLI:

```bash
gcloud auth application-default login
```

:::tip ADC credential chain
ADC tries, in order: `GOOGLE_APPLICATION_CREDENTIALS` environment variable → Well-known credential file → GCE metadata server. On GKE with Workload Identity or Cloud Run, service account credentials are resolved with no configuration needed.
:::

---

## Creating a Service Account

1. Open the [GCP Console](https://console.cloud.google.com)
2. Navigate to **IAM & Admin** → **Service Accounts**
3. Click **Create Service Account**
4. Assign the following roles on the bucket:

| Role | Required For |
|---|---|
| `Storage Object Admin` | Upload, download, delete, copy, metadata |
| `Storage Legacy Bucket Reader` | `ListFilesAsync`, `ListFoldersAsync` |

For minimum-privilege environments, use a custom role with only:
- `storage.objects.create`
- `storage.objects.get`
- `storage.objects.delete`
- `storage.objects.list`
- `storage.buckets.get`

5. Under the **Keys** tab, click **Add Key** → **Create new key** → **JSON** → download

Load the key in your application:

```csharp
// From environment variable (recommended for containers)
opts.JsonCredentials = Environment.GetEnvironmentVariable("GCP_SERVICE_ACCOUNT_JSON")
    ?? throw new InvalidOperationException("GCP_SERVICE_ACCOUNT_JSON is not set.");
```

---

## Creating a Bucket

```bash
# Create a bucket in a specific region
gcloud storage buckets create gs://my-app-uploads \
    --project=my-project-12345 \
    --location=us-central1 \
    --uniform-bucket-level-access

# Verify
gcloud storage buckets describe gs://my-app-uploads
```

---

## GCS Storage Classes

| Class | Min Retention | Use Case |
|---|---|---|
| `STANDARD` | None | Frequently accessed data. Highest cost, lowest retrieval cost. |
| `NEARLINE` | 30 days | Monthly access. ~50% lower storage cost. |
| `COLDLINE` | 90 days | Quarterly access. Lower cost, retrieval fees apply. |
| `ARCHIVE` | 365 days | Long-term backup. Lowest cost, highest retrieval cost. |

Use lifecycle rules to automatically transition objects between classes:

1. GCP Console → your bucket → **Lifecycle** tab
2. Add rule: e.g., move to `NEARLINE` after 30 days, `COLDLINE` after 90 days

---

## Presigned URLs (V4 Signed URLs)

`GCPStorageProvider` implements `IPresignedUrlProvider` using GCS V4 signed URLs. Signed URLs require a service account key (ADC cannot sign URLs) because the URL is signed with the service account's private key:

```csharp
var provider = factory.Create("gcp");

if (provider is IPresignedUrlProvider presigned)
{
    // V4 signed PUT URL — client uploads directly to GCS for 15 minutes
    var uploadUrl = await presigned.GetPresignedUploadUrlAsync(
        StoragePath.From("uploads", userId, "avatar.jpg"),
        expiresIn: TimeSpan.FromMinutes(15));

    // V4 signed GET URL — time-limited access to a private object
    var downloadUrl = await presigned.GetPresignedDownloadUrlAsync(
        "private/salary-report.pdf",
        expiresIn: TimeSpan.FromHours(1));

    return Results.Ok(new
    {
        uploadUrl   = uploadUrl.Value,
        downloadUrl = downloadUrl.Value
    });
}
```

V4 signed URLs have a maximum validity of **7 days**. The URL is self-contained — no server-side revocation or tracking is required.

---

## CORS Configuration for Direct Client Uploads

When clients upload directly via signed URLs, configure CORS on the bucket:

```bash
cat > cors.json << 'EOF'
[
  {
    "origin": ["https://myapp.com"],
    "method": ["PUT", "GET", "HEAD"],
    "responseHeader": ["Content-Type", "ETag", "x-goog-meta-*"],
    "maxAgeSeconds": 3600
  }
]
EOF

gcloud storage buckets update gs://my-app-uploads --cors-file=cors.json
```

---

## Local Development with Fake GCS Server

Use [fake-gcs-server](https://github.com/fsouza/fake-gcs-server) to emulate GCS locally without a GCP account:

```bash
docker run -d --name fake-gcs \
  -p 4443:4443 \
  fsouza/fake-gcs-server \
  -scheme http -port 4443
```

Configure ValiBlob to use the emulator:

```csharp
.AddProvider<GCPStorageProvider>("gcp", opts =>
{
    opts.ProjectId       = "test-project";
    opts.BucketName      = "dev-bucket";
    opts.JsonCredentials = "{\"type\":\"service_account\"}"; // minimal, not validated by emulator
    // Set STORAGE_EMULATOR_HOST=http://localhost:4443 in environment
})
```

The Google Cloud Storage SDK respects the `STORAGE_EMULATOR_HOST` environment variable automatically.

---

## Resumable Uploads (GCS Resumable Upload API)

ValiBlob maps `IResumableUploadProvider` to the GCS [Resumable Upload API](https://cloud.google.com/storage/docs/resumable-uploads):

| ValiBlob Operation | GCS API Operation |
|---|---|
| `StartResumableUploadAsync` | Initiate resumable upload session (returns upload URI) |
| `UploadChunkAsync` | Upload chunk to session URI with `Content-Range` |
| `CompleteResumableUploadAsync` | Final chunk upload signals completion |
| `AbortResumableUploadAsync` | DELETE request to session URI |

GCS resumable uploads support chunks as small as 256 KiB (must be a multiple of 256 KiB except for the last chunk). Recommended chunk size: 8 MiB.

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | Single PUT or resumable |
| `DownloadAsync` | Yes | Including byte range |
| `DeleteAsync` | Yes | |
| `DeleteFolderAsync` | Yes | Batch list + delete by prefix |
| `ExistsAsync` | Yes | Objects.Get with fields=name |
| `CopyAsync` | Yes | Server-side copy |
| `GetMetadataAsync` | Yes | Object metadata + custom metadata |
| `SetMetadataAsync` | Yes | Patch object metadata |
| `ListFilesAsync` | Yes | Objects.List with prefix + pagination |
| `ListFoldersAsync` | Yes | Objects.List with delimiter |
| `GetUrlAsync` | Yes | Public URL or signed URL |
| `StartResumableUploadAsync` | Yes | GCS resumable session |
| `UploadChunkAsync` | Yes | Chunk PUT to session URI |
| `CompleteResumableUploadAsync` | Yes | Final chunk signals completion |
| `AbortResumableUploadAsync` | Yes | DELETE session URI |
| `GetPresignedUploadUrlAsync` | Yes | V4 signed PUT URL |
| `GetPresignedDownloadUrlAsync` | Yes | V4 signed GET URL |

---

## Related

- [Packages](../packages.md) — Full package reference
- [Presigned URLs](../advanced/presigned-urls.md) — Time-limited access patterns
- [Resumable Uploads](../resumable/overview.md) — Large file uploads via GCS resumable API
- [Migration](../advanced/migration.md) — Migrate files between providers
