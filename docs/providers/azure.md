---
title: Azure Blob Storage Provider
sidebar_label: Azure Blob Storage
sidebar_position: 2
---

# Azure Blob Storage Provider

`ValiBlob.Azure` provides `AzureBlobProvider`, implementing `IStorageProvider`, `IResumableUploadProvider`, and `IPresignedUrlProvider` backed by Azure Blob Storage via `Azure.Storage.Blobs`.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.Azure
```

---

## AzureBlobOptions Reference

| Option | Type | Required | Description |
|---|---|---|---|
| `ConnectionString` | `string?` | Yes* | Storage account connection string. Not required when using Managed Identity. |
| `AccountName` | `string?` | Yes* | Storage account name. Required when using Managed Identity (`TokenCredential`). |
| `ContainerName` | `string` | Yes | Blob container name for all operations. |
| `CreateIfNotExists` | `bool` | No | Create the container on startup if it does not exist. Default: `false`. |
| `PublicAccess` | `PublicAccessType` | No | Container public access: `None`, `Blob`, or `Container`. Default: `None`. |
| `DefaultBlobTier` | `AccessTier?` | No | Default access tier for uploaded blobs: `Hot`, `Cool`, or `Archive`. Default: `null` (inherits account default). |

\* Either `ConnectionString` or `AccountName` (with a registered `TokenCredential`) must be provided.

---

## DI Registration

### Connection String

```csharp
using ValiBlob.Core;
using ValiBlob.Azure;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure")
    .AddProvider<AzureBlobProvider>("azure", opts =>
    {
        opts.ConnectionString = builder.Configuration["Azure:ConnectionString"]!;
        opts.ContainerName   = builder.Configuration["Azure:ContainerName"]!;
        opts.CreateIfNotExists = true;
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
  "Azure": {
    "ConnectionString": "DefaultEndpointsProtocol=https;AccountName=mystorageaccount;AccountKey=base64key==;EndpointSuffix=core.windows.net",
    "ContainerName": "uploads"
  }
}
```

:::warning Never commit credentials
Store connection strings in `dotnet user-secrets` for development. Use Azure Key Vault, environment variables, or managed secrets in production. Never commit connection strings to source control.
:::

---

## Managed Identity (Recommended for Production)

When running on Azure (App Service, AKS, Azure Functions, VMs), use Managed Identity instead of static credentials. This eliminates secret rotation concerns entirely.

### Step 1: Enable Managed Identity

Enable a system-assigned Managed Identity on your compute resource in the Azure Portal, then assign it the `Storage Blob Data Contributor` RBAC role on your storage account.

### Step 2: Register `DefaultAzureCredential`

```csharp
using Azure.Identity;
using Azure.Core;

// Register the credential — automatically resolves Managed Identity in Azure,
// developer tooling (Azure CLI, VS, VS Code) locally
builder.Services.AddSingleton<TokenCredential>(new DefaultAzureCredential());
```

### Step 3: Configure ValiBlob with AccountName

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure")
    .AddProvider<AzureBlobProvider>("azure", opts =>
    {
        // No ConnectionString — TokenCredential resolved from DI
        opts.AccountName   = builder.Configuration["Azure:AccountName"]!;
        opts.ContainerName = "uploads";
    });
```

### appsettings.json

```json
{
  "Azure": {
    "AccountName": "mystorageaccount",
    "ContainerName": "uploads"
  }
}
```

:::tip DefaultAzureCredential credential chain
`DefaultAzureCredential` tries, in order: Environment variables → Workload Identity → Managed Identity → Azure Developer CLI → Azure CLI → Azure PowerShell → Azure CLI (interactive). In production Azure environments, Managed Identity is resolved automatically with no configuration.
:::

---

## Container Access Tiers

| Access Level | Description |
|---|---|
| `None` | Private — all access requires a valid SAS token or authenticated request. Recommended default. |
| `Blob` | Anonymous read access for individual blobs. Container listing requires authentication. |
| `Container` | Full public read access including listing. Use only for truly public assets. |

---

## Blob Access Tiers

| Tier | Access Pattern | Notes |
|---|---|---|
| `Hot` | Frequent | Default. Highest storage cost, lowest access latency and cost. |
| `Cool` | Infrequent (30+ days) | ~50% lower storage cost. Early deletion fee if deleted before 30 days. |
| `Archive` | Rare (180+ days) | Lowest cost. Requires rehydration (hours to days) before reading. |

Configure `DefaultBlobTier` in `AzureBlobOptions`, or use lifecycle management rules in the Azure Portal to tier blobs automatically.

---

## Presigned URLs (SAS Tokens)

`AzureBlobProvider` implements `IPresignedUrlProvider`. Presigned URLs use Shared Access Signatures (SAS) to grant time-limited, scoped access to a specific blob — your server never touches file data during client transfers:

```csharp
var provider = factory.Create("azure");

if (provider is IPresignedUrlProvider presigned)
{
    // SAS PUT URL — client uploads directly to Azure for 30 minutes
    var uploadUrl = await presigned.GetPresignedUploadUrlAsync(
        StoragePath.From("uploads", userId, "avatar.jpg"),
        expiresIn: TimeSpan.FromMinutes(30));

    // SAS GET URL — time-limited download for 2 hours
    var downloadUrl = await presigned.GetPresignedDownloadUrlAsync(
        "private/salary-report.pdf",
        expiresIn: TimeSpan.FromHours(2));

    return Results.Ok(new
    {
        uploadUrl   = uploadUrl.Value,
        downloadUrl = downloadUrl.Value
    });
}
```

SAS tokens are self-contained: the expiry, permissions, and cryptographic signature are embedded in the URL. No server-side revocation or tracking is required; access expires automatically.

---

## CORS Configuration for Direct Client Uploads

When clients upload directly via presigned SAS URLs, configure CORS on your storage account:

```bash
az storage cors add \
    --services b \
    --methods PUT GET HEAD \
    --origins "https://myapp.com" \
    --allowed-headers "*" \
    --exposed-headers "ETag,x-ms-request-id" \
    --max-age 3600 \
    --account-name mystorageaccount
```

---

## Azurite (Local Development)

[Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) is the official Azure Storage emulator for local development — no Azure account required:

```bash
# Via Docker
docker run -d --name azurite \
  -p 10000:10000 \
  mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
```

Configure ValiBlob to use Azurite:

```csharp
.AddProvider<AzureBlobProvider>("azure", opts =>
{
    opts.ConnectionString  = "UseDevelopmentStorage=true";
    opts.ContainerName     = "dev-uploads";
    opts.CreateIfNotExists = true;
})
```

The well-known `UseDevelopmentStorage=true` alias points to Azurite's default endpoint at `http://127.0.0.1:10000/devstoreaccount1`.

---

## Multiple Containers

Configure multiple named providers to route different content types to different containers:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure-uploads")
    .AddProvider<AzureBlobProvider>("azure-uploads", opts =>
    {
        opts.ConnectionString = config["Azure:ConnectionString"]!;
        opts.ContainerName   = "user-uploads";
    })
    .AddProvider<AzureBlobProvider>("azure-archives", opts =>
    {
        opts.ConnectionString  = config["Azure:ConnectionString"]!;
        opts.ContainerName    = "archives";
        opts.DefaultBlobTier  = AccessTier.Cool;
    });

// Route to specific container
var archiveProvider = factory.Create("azure-archives");
```

---

## Lifecycle Management

Configure lifecycle rules in the Azure Portal to automatically tier or delete old blobs:

1. Navigate to your storage account → **Data management** → **Lifecycle management**
2. Add rules:

| Rule | Condition | Action |
|---|---|---|
| Tier to Cool | Last modified > 30 days | Move to Cool tier |
| Tier to Archive | Last modified > 90 days | Move to Archive tier |
| Delete | Last modified > 365 days | Delete blob |

This is ideal for temporary uploads, expiring content, and compliance-driven retention policies.

---

## Large File Uploads (Resumable)

Azure Blob Storage block blobs support resumable uploads via block staging. ValiBlob maps its `IResumableUploadProvider` interface to the Azure Block Blob API:

| ValiBlob Operation | Azure SDK Operation |
|---|---|
| `StartResumableUploadAsync` | Initializes a tracked session with a block list |
| `UploadChunkAsync` | `StageBlockAsync` — each chunk is a staged block |
| `CompleteResumableUploadAsync` | `CommitBlockListAsync` |
| `AbortResumableUploadAsync` | Discards staged blocks |

Maximum block size: 4,000 MB per block. Maximum blob size: 190.7 TiB.

:::info ContentLength and Azure Blob
Azure Blob's `StageBlockAsync` requires a known content length for each block. ValiBlob ensures chunks are fully buffered before staging, so the block size is always known. When the compression middleware is active, ValiBlob uses chunked transfer encoding to avoid requiring the final compressed size upfront.
:::

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | Block blob PUT or multipart |
| `DownloadAsync` | Yes | Including byte range (partial content) |
| `DeleteAsync` | Yes | |
| `DeleteFolderAsync` | Yes | Batch list + delete by prefix |
| `ExistsAsync` | Yes | BlobClient.ExistsAsync |
| `CopyAsync` | Yes | Server-side copy within the same account |
| `GetMetadataAsync` | Yes | BlobProperties + custom metadata |
| `SetMetadataAsync` | Yes | SetMetadataAsync |
| `ListFilesAsync` | Yes | GetBlobsAsync with prefix + pagination |
| `ListFoldersAsync` | Yes | GetBlobsByHierarchyAsync with delimiter |
| `GetUrlAsync` | Yes | Public URL or SAS URL |
| `StartResumableUploadAsync` | Yes | Block blob staging |
| `UploadChunkAsync` | Yes | StageBlockAsync |
| `CompleteResumableUploadAsync` | Yes | CommitBlockListAsync |
| `AbortResumableUploadAsync` | Yes | Discard staged blocks |
| `GetPresignedUploadUrlAsync` | Yes | SAS PUT URL |
| `GetPresignedDownloadUrlAsync` | Yes | SAS GET URL |

---

## Related

- [Packages](../packages.md) — Full package reference
- [Presigned URLs](../advanced/presigned-urls.md) — Time-limited access patterns
- [Resumable Uploads](../resumable/overview.md) — Large file uploads
- [Migration](../advanced/migration.md) — Migrate files between providers
