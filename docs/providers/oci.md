---
title: Oracle Cloud Infrastructure Provider
sidebar_label: OCI Object Storage
sidebar_position: 4
---

# Oracle Cloud Infrastructure Provider

`ValiBlob.OCI` provides `OCIStorageProvider`, implementing `IStorageProvider`, `IResumableUploadProvider`, and `IPresignedUrlProvider` backed by OCI Object Storage via the official OCI .NET SDK.

Presigned URLs are implemented using OCI **Pre-Authenticated Requests (PARs)** — unlike AWS and GCP which generate signed URLs locally in memory, OCI requires an API call to create each PAR. See [Presigned URLs](#presigned-urls-pre-authenticated-requests) for details.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.OCI
```

---

## OCIStorageOptions Reference

| Option | Type | Required | Description |
|---|---|---|---|
| `Namespace` | `string` | Yes | OCI Object Storage namespace (unique per tenancy). |
| `BucketName` | `string` | Yes | Object Storage bucket name. |
| `Region` | `string` | Yes | OCI region identifier, e.g. `"us-ashburn-1"`, `"eu-frankfurt-1"`. |
| `TenancyId` | `string` | Yes | OCID of the tenancy, e.g. `"ocid1.tenancy.oc1..aaa..."`. |
| `UserId` | `string` | Yes | OCID of the API signing user, e.g. `"ocid1.user.oc1..aaa..."`. |
| `FingerPrint` | `string` | Yes | Fingerprint of the API signing key, e.g. `"xx:yy:zz:..."`. |
| `PrivateKey` | `string` | Yes | RSA private key in PEM format used to sign API requests. |

---

## DI Registration

```csharp
using ValiBlob.Core;
using ValiBlob.OCI;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "oci")
    .AddProvider<OCIStorageProvider>("oci", opts =>
    {
        opts.Namespace   = builder.Configuration["OCI:Namespace"]!;
        opts.BucketName  = builder.Configuration["OCI:BucketName"]!;
        opts.Region      = builder.Configuration["OCI:Region"]!;
        opts.TenancyId   = builder.Configuration["OCI:TenancyId"]!;
        opts.UserId      = builder.Configuration["OCI:UserId"]!;
        opts.FingerPrint = builder.Configuration["OCI:FingerPrint"]!;
        opts.PrivateKey  = builder.Configuration["OCI:PrivateKey"]!;
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

:::warning Protect your private key
The RSA private key signs every API request. Store it in OCI Vault, a Kubernetes Secret, or an environment variable. Never commit `.pem` files or PEM content to source control.
:::

---

## Finding Your Namespace

The Object Storage namespace is a short alphanumeric string unique to your tenancy.

**Via OCI Console:**
1. Click the profile icon (top-right) → **Tenancy: \<name\>**
2. The **Object Storage Namespace** appears in the tenancy details page.

**Via OCI CLI:**
```bash
oci os ns get
```

---

## Obtaining API Signing Credentials

### Generate an RSA Key Pair

```bash
# Generate 2048-bit RSA private key
openssl genrsa -out oci_api_key.pem 2048

# Extract the public key for upload to OCI
openssl rsa -in oci_api_key.pem -pubout -out oci_api_key_public.pem

# Compute the fingerprint (matches what OCI shows after uploading the public key)
openssl rsa -in oci_api_key.pem -pubout -outform DER | openssl md5 -c
```

### Upload the Public Key to OCI

1. OCI Console → **Identity & Security** → **Users**
2. Open your API user (or create a dedicated service user)
3. Scroll to **API Keys** → **Add API Key** → **Paste a public key**
4. Paste the contents of `oci_api_key_public.pem`
5. Copy the displayed fingerprint — this is your `FingerPrint` value

### Load Credentials in Your Application

```csharp
// Option 1: From environment variable (recommended for containers)
opts.PrivateKey = Environment.GetEnvironmentVariable("OCI_PRIVATE_KEY_PEM")
    ?? throw new InvalidOperationException("OCI_PRIVATE_KEY_PEM is not set.");

// Option 2: From a mounted secret file (Kubernetes)
opts.PrivateKey = File.ReadAllText("/run/secrets/oci-private-key");

// Option 3: From configuration (only for development; store via dotnet user-secrets)
opts.PrivateKey = builder.Configuration["OCI:PrivateKey"]!;
```

---

## IAM Policies

Grant the API user (or a group) access to Object Storage operations:

```
# Full object operations on a specific bucket
Allow group valiblob-group to manage objects in tenancy
    where target.bucket.name = 'my-app-uploads'

# Allow namespace and bucket reads (required for list operations)
Allow group valiblob-group to read objectstorage-namespaces in tenancy
Allow group valiblob-group to read buckets in compartment my-compartment
```

For minimum-privilege access:

```
Allow group valiblob-group to use object-family in compartment my-compartment
    where target.bucket.name = 'my-app-uploads'
```

Navigate to **Identity & Security** → **Policies** → **Create Policy** in the OCI Console.

---

## Creating a Bucket

```bash
# Create a bucket
oci os bucket create \
    --compartment-id ocid1.compartment.oc1..aaa... \
    --name my-app-uploads \
    --namespace axjklopqrstu \
    --versioning Disabled

# Verify
oci os bucket get \
    --bucket-name my-app-uploads \
    --namespace axjklopqrstu
```

---

## Presigned URLs (Pre-Authenticated Requests)

`OCIStorageProvider` implements `IPresignedUrlProvider` using OCI **Pre-Authenticated Requests (PARs)**.

### How OCI PARs differ from AWS/GCP presigned URLs

This is an important architectural difference to understand before using presigned URLs with OCI:

| | AWS S3 / GCP Cloud Storage | OCI Object Storage |
|---|---|---|
| **How the URL is generated** | Signed locally in memory using your credentials (HMAC-SHA256 / RSA) — **no network call** | A PAR object is **created on OCI's servers** via an API call — requires a round-trip |
| **Network cost per URL** | Zero — pure CPU operation | One HTTP request to OCI per URL generated |
| **Latency** | Sub-millisecond | Depends on network latency to OCI (~50–200 ms) |
| **Server-side lifecycle** | URL is stateless — OCI/AWS/GCP have no record of it | PAR is a real object: it can be listed, deactivated, or deleted from the Console or CLI |
| **Rate limits** | None for URL generation | OCI imposes API rate limits on PAR creation |

**Practical impact:** if your application generates presigned URLs at high frequency (e.g. one per file request in a high-traffic API), the extra round-trip adds latency per URL. In low-to-moderate-traffic scenarios this is negligible.

### Usage

The API is identical to other providers — ValiBlob abstracts the difference:

```csharp
var provider = factory.Create("oci");

if (provider is IPresignedUrlProvider presigned)
{
    // Creates a PAR on OCI granting PUT access for 15 minutes
    var uploadUrl = await presigned.GetPresignedUploadUrlAsync(
        StoragePath.From("uploads", userId, "report.pdf"),
        expiresIn: TimeSpan.FromMinutes(15));

    // Creates a PAR on OCI granting GET access for 2 hours
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

### Caching recommendation

Because each call to `GetPresignedUploadUrlAsync` / `GetPresignedDownloadUrlAsync` makes an HTTP request to OCI, cache the resulting URLs when **the same user** accesses **the same resource** repeatedly within the validity window.

:::warning Always include the user in the cache key
Cache keys must be scoped per user. A PAR gives unauthenticated access to the file for its entire lifetime — sharing the same URL across different users is a security risk even if the bucket is private.
:::

```csharp
// Always scope the cache key to the user AND the path
var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)!;
var cacheKey = $"oci-par:{userId}:{path}";

if (!cache.TryGetValue(cacheKey, out string? url))
{
    var expiration = TimeSpan.FromHours(2);
    var result = await presigned.GetPresignedDownloadUrlAsync(path, expiration);
    url = result.Value;
    cache.Set(cacheKey, url, expiration * 0.9); // expire cache before PAR expires
}
```

:::info PAR lifecycle management
PARs are real server-side objects in OCI. You can view, deactivate, or delete them under **Storage → Buckets → \<bucket\> → Pre-Authenticated Requests** in the OCI Console, or via the OCI CLI (`oci os preauth-request list`). This gives you the ability to revoke access to a URL after it has been issued — something that is not possible with AWS or GCP presigned URLs.
:::

---

## OCI Region Identifiers

| Region | Identifier |
|---|---|
| US East (Ashburn) | `us-ashburn-1` |
| US West (Phoenix) | `us-phoenix-1` |
| EU (Frankfurt) | `eu-frankfurt-1` |
| EU (Amsterdam) | `eu-amsterdam-1` |
| UK (London) | `uk-london-1` |
| AP (Tokyo) | `ap-tokyo-1` |
| AP (Sydney) | `ap-sydney-1` |
| Brazil (Sao Paulo) | `sa-saopaulo-1` |
| Canada (Toronto) | `ca-toronto-1` |
| Middle East (Dubai) | `me-dubai-1` |

---

## Resumable Uploads (OCI Multipart Upload)

ValiBlob maps `IResumableUploadProvider` to OCI's native multipart upload API:

| ValiBlob Operation | OCI API Operation |
|---|---|
| `StartResumableUploadAsync` | `CreateMultipartUpload` |
| `UploadChunkAsync` | `UploadPart` |
| `CompleteResumableUploadAsync` | `CommitMultipartUpload` |
| `AbortResumableUploadAsync` | `AbortMultipartUpload` |

OCI multipart upload constraints:
- Minimum part size: **1 MiB** (except the last part)
- Maximum parts per upload: **10,000**
- Recommended part size: **5–100 MiB**

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | Single PUT or multipart |
| `DownloadAsync` | Yes | Including byte range |
| `DeleteAsync` | Yes | |
| `DeleteFolderAsync` | Yes | Batch list + delete by prefix |
| `ExistsAsync` | Yes | HeadObject |
| `CopyAsync` | Yes | Server-side copy |
| `GetMetadataAsync` | Yes | HeadObject + custom metadata |
| `SetMetadataAsync` | Yes | Copy-in-place with new metadata |
| `ListFilesAsync` | Yes | ListObjects with prefix + pagination |
| `ListFoldersAsync` | Yes | ListObjects with delimiter |
| `GetUrlAsync` | Yes | Public URL or PAR URL |
| `StartResumableUploadAsync` | Yes | OCI CreateMultipartUpload |
| `UploadChunkAsync` | Yes | OCI UploadPart |
| `CompleteResumableUploadAsync` | Yes | OCI CommitMultipartUpload |
| `AbortResumableUploadAsync` | Yes | OCI AbortMultipartUpload |
| `GetPresignedUploadUrlAsync` | Yes | Pre-Authenticated Request (PAR) |
| `GetPresignedDownloadUrlAsync` | Yes | Pre-Authenticated Request (PAR) |

---

## Troubleshooting

### 401 Unauthorized

- Verify that `TenancyId`, `UserId`, and `FingerPrint` exactly match what the OCI Console shows (these values are case-sensitive).
- Confirm the API key is **Active** in the user's API key list.
- Ensure the private key PEM corresponds to the uploaded public key.

### 404 Not Found on Bucket Operations

- Verify the `Namespace` is correct — it is case-sensitive.
- Confirm the bucket exists in the specified region and compartment.
- Check that IAM policies grant the user access to the compartment containing the bucket.

### Clock Skew Errors

OCI request signatures include a `Date` header. Requests are rejected if the server clock differs by more than 5 minutes from OCI's servers. Ensure your server uses NTP and system time is accurate.

```bash
# Check system time (Linux)
timedatectl status
```

---

## Related

- [Packages](../packages.md) — Full package reference
- [Presigned URLs](../advanced/presigned-urls.md) — Time-limited access patterns
- [Resumable Uploads](../resumable/overview.md) — Large file uploads via OCI multipart
- [Migration](../advanced/migration.md) — Migrate files between providers
