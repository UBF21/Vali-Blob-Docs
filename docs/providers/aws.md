---
title: AWS S3 Provider
sidebar_label: AWS S3
sidebar_position: 1
---

# AWS S3 Provider

`ValiBlob.AWS` provides full `IStorageProvider`, `IResumableUploadProvider`, and `IPresignedUrlProvider` implementations backed by Amazon S3 via `AWSSDK.S3`.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.AWS
```

---

## AWSS3Options Reference

| Option | Type | Required | Description |
|---|---|---|---|
| `BucketName` | `string` | Yes | S3 bucket name |
| `Region` | `string` | Yes | AWS region code (e.g., `us-east-1`, `eu-west-1`) |
| `AccessKey` | `string?` | No | AWS access key ID. Leave `null` to use IAM role / environment credentials |
| `SecretKey` | `string?` | No | AWS secret access key. Leave `null` for IAM role |
| `ServiceUrl` | `string?` | No | Override endpoint URL — use `http://localhost:4566` for LocalStack |
| `ForcePathStyle` | `bool` | No | Use path-style URLs. Required for LocalStack and MinIO. Default: `false` |
| `ServerSideEncryption` | `ServerSideEncryptionMethod?` | No | Enable provider-side encryption: `AES256` or `AWSKMS` |
| `SseKmsKeyId` | `string?` | No | KMS key ARN when using `AWSKMS` encryption |

---

## DI Registration

```csharp
using ValiBlob.Core;
using ValiBlob.AWS;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region     = builder.Configuration["AWS:Region"]!;
        opts.AccessKey  = builder.Configuration["AWS:AccessKey"];   // null → use IAM role
        opts.SecretKey  = builder.Configuration["AWS:SecretKey"];
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
  "AWS": {
    "BucketName": "my-app-bucket",
    "Region": "us-east-1"
  }
}
```

:::tip IAM roles in production
On AWS (EC2, ECS, Lambda, EKS), set `AccessKey` and `SecretKey` to `null`. The SDK resolves credentials automatically from the instance/task role via IMDS. This is more secure than static credentials and eliminates rotation concerns.
:::

:::warning Never commit credentials
Use `dotnet user-secrets` for development credentials. In CI/CD, use environment variables or secrets managers. Never commit AWS credentials to source control.
:::

---

## IAM Policy

Grant your instance/task role the following permissions on the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject",
        "s3:CopyObject"
      ],
      "Resource": "arn:aws:s3:::my-app-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::my-app-bucket"
    }
  ]
}
```

For resumable (multipart) uploads, add:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:CreateMultipartUpload",
    "s3:UploadPart",
    "s3:CompleteMultipartUpload",
    "s3:AbortMultipartUpload",
    "s3:ListMultipartUploadParts"
  ],
  "Resource": "arn:aws:s3:::my-app-bucket/*"
}
```

---

## Presigned URLs

`AWSS3Provider` implements `IPresignedUrlProvider`. Use presigned URLs to let browsers and mobile clients upload or download directly to/from S3 — your server never touches the file data:

```csharp
var provider = factory.Create("aws");

if (provider is IPresignedUrlProvider presigned)
{
    // Presigned PUT URL — client uploads directly to S3 for 15 minutes
    var uploadUrl = await presigned.GetPresignedUploadUrlAsync(
        StoragePath.From("uploads", userId, "avatar.jpg"),
        expiresIn: TimeSpan.FromMinutes(15));

    // Presigned GET URL — client downloads directly from S3 for 1 hour
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

---

## LocalStack (Local Development)

[LocalStack](https://localstack.cloud/) provides a local S3-compatible endpoint for development and testing with no AWS account required:

```bash
docker run -d --name localstack -p 4566:4566 localstack/localstack
# Create bucket
aws --endpoint-url=http://localhost:4566 s3 mb s3://dev-bucket
```

Configure ValiBlob for LocalStack:

```csharp
.AddProvider<AWSS3Provider>("aws", opts =>
{
    opts.BucketName     = "dev-bucket";
    opts.Region         = "us-east-1";
    opts.AccessKey      = "test";        // any non-empty value
    opts.SecretKey      = "test";
    opts.ServiceUrl     = "http://localhost:4566";
    opts.ForcePathStyle = true;          // required for LocalStack
})
```

---

## MinIO (Self-Hosted S3-Compatible)

```bash
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  minio/minio server /data --console-address ":9001"
```

```csharp
.AddProvider<AWSS3Provider>("minio", opts =>
{
    opts.BucketName     = "my-bucket";
    opts.Region         = "us-east-1";    // required by SDK but arbitrary for MinIO
    opts.AccessKey      = "minioadmin";
    opts.SecretKey      = "minioadmin123";
    opts.ServiceUrl     = "http://localhost:9000";
    opts.ForcePathStyle = true;
})
```

---

## Multiple Regions

Configure multiple named providers for multi-region deployments:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws-us")
    .AddProvider<AWSS3Provider>("aws-us", opts =>
    {
        opts.BucketName = "my-app-us";
        opts.Region     = "us-east-1";
    })
    .AddProvider<AWSS3Provider>("aws-eu", opts =>
    {
        opts.BucketName = "my-app-eu";
        opts.Region     = "eu-west-1";
    });

// Resolve by name
var usProvider = factory.Create("aws-us");
var euProvider = factory.Create("aws-eu");
```

---

## Server-Side Encryption

Use provider-side encryption in addition to ValiBlob's application-layer encryption:

```csharp
opts.ServerSideEncryption = ServerSideEncryptionMethod.AES256;   // SSE-S3
// or AWS KMS:
opts.ServerSideEncryption = ServerSideEncryptionMethod.AWSKMS;
opts.SseKmsKeyId          = "arn:aws:kms:us-east-1:123456789:key/your-key-id";
```

:::info Defense in depth
ValiBlob's `EncryptionMiddleware` encrypts at the application layer before bytes leave your process. S3 server-side encryption (SSE-S3 or SSE-KMS) adds a second encryption layer at the storage layer. Using both provides defense-in-depth for sensitive data.
:::

---

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `UploadAsync` | Yes | Single PUT or multipart |
| `DownloadAsync` | Yes | Including byte range (partial content) |
| `DeleteAsync` | Yes | |
| `DeleteFolderAsync` | Yes | Batch delete via ListObjectsV2 + DeleteObjects |
| `ExistsAsync` | Yes | Uses HeadObject |
| `CopyAsync` | Yes | Server-side copy |
| `GetMetadataAsync` | Yes | HeadObject + custom metadata |
| `SetMetadataAsync` | Yes | Copy-in-place with new metadata |
| `ListFilesAsync` | Yes | ListObjectsV2 with auto-pagination |
| `ListFoldersAsync` | Yes | ListObjectsV2 with delimiter |
| `GetUrlAsync` | Yes | Public or presigned URL |
| `StartResumableUploadAsync` | Yes | S3 CreateMultipartUpload |
| `UploadChunkAsync` | Yes | S3 UploadPart |
| `CompleteResumableUploadAsync` | Yes | S3 CompleteMultipartUpload |
| `AbortResumableUploadAsync` | Yes | S3 AbortMultipartUpload |
| `GetPresignedUploadUrlAsync` | Yes | Pre-signed PUT URL |
| `GetPresignedDownloadUrlAsync` | Yes | Pre-signed GET URL |

---

## Related

- [Packages](../packages.md) — Full package reference
- [Presigned URLs](../advanced/presigned-urls.md) — Time-limited access patterns
- [Resumable Uploads](../resumable/overview.md) — Large file uploads via S3 multipart
- [Migration](../advanced/migration.md) — Migrate files between providers
