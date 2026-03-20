---
title: CDN Integration
sidebar_label: CDN Integration
sidebar_position: 3
---

# CDN Integration

ValiBlob provides an `ICdnProvider` abstraction that maps storage object paths to CDN-backed URLs. By routing downloads through a CDN, you reduce latency for end users and offload bandwidth from your origin storage.

---

## Interface

```csharp
public interface ICdnProvider
{
    /// <summary>
    /// Returns the CDN URL for the given storage path.
    /// </summary>
    Task<string> GetUrlAsync(StoragePath path, CancellationToken ct = default);
}
```

---

## Built-in: PrefixCdnProvider

ValiBlob ships with `PrefixCdnProvider`, which prepends a base CDN URL to a storage path. This covers the vast majority of CDN configurations:

```csharp
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://d1234abcd.cloudfront.net"));

// Usage
var cdn    = sp.GetRequiredService<ICdnProvider>();
var cdnUrl = await cdn.GetUrlAsync("uploads/image.jpg");
// → https://d1234abcd.cloudfront.net/uploads/image.jpg
```

The base URL is concatenated with the storage path using a single `/` separator. Leading slashes in the path are normalized automatically.

---

## CDN Configuration Examples

### Amazon CloudFront (S3 Origin)

1. Create a CloudFront distribution pointing to your S3 bucket as the origin.
2. Copy the distribution domain name, e.g. `d1234abcd.cloudfront.net`.

```csharp
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://d1234abcd.cloudfront.net"));
```

**Restrict S3 access to CloudFront only (Origin Access Control):**
- In CloudFront, create an Origin Access Control (OAC) for your S3 origin.
- Update your S3 bucket policy to allow requests only from the CloudFront distribution.
- This prevents direct S3 URL access, forcing all traffic through the CDN.

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789:distribution/ABCDEFG"
        }
      }
    }
  ]
}
```

### Azure CDN / Front Door

```csharp
// Azure CDN endpoint
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://my-app.azureedge.net"));

// Azure Front Door
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://my-app.z01.azurefd.net"));
```

### Google Cloud CDN

1. Create a Cloud Load Balancer with a backend bucket pointing to your GCS bucket.
2. Enable Cloud CDN on the backend bucket.

```csharp
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://cdn.myapp.com")); // custom domain → Cloud LB
```

### Cloudflare

1. Add your storage domain to Cloudflare DNS (CNAME → storage origin).
2. Enable orange-cloud proxy mode on the DNS record.

```csharp
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://assets.myapp.com"));
```

### Cloudflare R2 (Zero Egress)

Cloudflare R2 has no egress fees. Use the public R2 URL as the CDN base:

```csharp
builder.Services.AddSingleton<ICdnProvider>(
    new PrefixCdnProvider("https://pub-abc123.r2.dev"));
```

---

## Using CDN URLs in Your Application

Inject `ICdnProvider` (optional dependency) wherever you serve files to users:

```csharp
public class FileService
{
    private readonly IStorageProvider _storage;
    private readonly ICdnProvider?    _cdn;

    public FileService(
        IStorageFactory factory,
        ICdnProvider? cdn = null) // null if not registered
    {
        _storage = factory.Create("aws");
        _cdn     = cdn;
    }

    public async Task<string> GetPublicUrlAsync(string storagePath)
    {
        if (_cdn is not null)
            return await _cdn.GetUrlAsync(storagePath);

        // Fall back to direct storage URL
        var meta = await _storage.GetMetadataAsync(storagePath);
        return meta.IsSuccess ? meta.Value.Url ?? storagePath : storagePath;
    }
}
```

In a minimal API:

```csharp
app.MapGet("/files/{**path}", async (string path, ICdnProvider? cdn) =>
{
    if (cdn is not null)
    {
        var url = await cdn.GetUrlAsync(path);
        return Results.Redirect(url, permanent: false);
    }

    // No CDN configured — stream from storage
    var provider = factory.Create("aws");
    var result   = await provider.DownloadAsync(path);
    return result.IsSuccess
        ? Results.Stream(result.Value)
        : Results.NotFound();
});
```

---

## Signed CloudFront URLs (Private CDN Content)

For private CDN content, implement `ICdnProvider` with CloudFront signed URLs:

```csharp
public class SignedCloudFrontCdnProvider : ICdnProvider
{
    private readonly string  _baseUrl;
    private readonly string  _keyPairId;
    private readonly RSA     _privateKey;
    private readonly TimeSpan _ttl;

    public SignedCloudFrontCdnProvider(
        string baseUrl, string keyPairId, string privateKeyPem,
        TimeSpan ttl)
    {
        _baseUrl    = baseUrl.TrimEnd('/');
        _keyPairId  = keyPairId;
        _privateKey = RSA.Create();
        _privateKey.ImportFromPem(privateKeyPem);
        _ttl = ttl;
    }

    public Task<string> GetUrlAsync(StoragePath path, CancellationToken ct = default)
    {
        var resource = $"{_baseUrl}/{path.Value.TrimStart('/')}";
        var expiry   = DateTimeOffset.UtcNow.Add(_ttl).ToUnixTimeSeconds();
        var policy   = $"{{\"Statement\":[{{\"Resource\":\"{resource}\"," +
                       $"\"Condition\":{{\"DateLessThan\":{{\"AWS:EpochTime\":{expiry}}}}}}}]}}";

        var policyBytes = Encoding.UTF8.GetBytes(policy);
        var signature   = _privateKey.SignData(
            policyBytes, HashAlgorithmName.SHA1, RSASignaturePadding.Pkcs1);

        var sig = Convert.ToBase64String(signature)
            .Replace('+', '-').Replace('=', '_').Replace('/', '~');

        return Task.FromResult(
            $"{resource}?Expires={expiry}&Signature={sig}&Key-Pair-Id={_keyPairId}");
    }
}

// Registration
builder.Services.AddSingleton<ICdnProvider>(
    new SignedCloudFrontCdnProvider(
        baseUrl:       "https://d1234abcd.cloudfront.net",
        keyPairId:     config["CloudFront:KeyPairId"]!,
        privateKeyPem: File.ReadAllText("cloudfront-key.pem"),
        ttl:           TimeSpan.FromHours(1)));
```

---

## Cache Invalidation

When a file is updated or deleted, the CDN may serve stale content until the TTL expires. Invalidate the cache for time-sensitive content.

### CloudFront Invalidation (AWSSDK)

```csharp
await cloudFrontClient.CreateInvalidationAsync(new CreateInvalidationRequest
{
    DistributionId = distributionId,
    InvalidationBatch = new InvalidationBatch
    {
        CallerReference = Guid.NewGuid().ToString(),
        Paths = new Paths
        {
            Quantity = 1,
            Items    = [$"/{storagePath}"]
        }
    }
});
```

### Cloudflare Cache Purge

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
     -H "Authorization: Bearer {api_token}" \
     -H "Content-Type: application/json" \
     -d "{\"files\":[\"https://assets.myapp.com/uploads/old-image.jpg\"]}"
```

### Decorator Pattern: Auto-Invalidate on Delete

Wrap your storage provider to invalidate the CDN automatically whenever a file is deleted or updated:

```csharp
public class CdnInvalidatingStorageProvider : IStorageProvider
{
    private readonly IStorageProvider _inner;
    private readonly ICdnInvalidator  _invalidator;

    public CdnInvalidatingStorageProvider(
        IStorageProvider inner, ICdnInvalidator invalidator)
    {
        _inner       = inner;
        _invalidator = invalidator;
    }

    public async Task<StorageResult> DeleteAsync(
        StoragePath path, CancellationToken ct = default)
    {
        var result = await _inner.DeleteAsync(path, ct);
        if (result.IsSuccess)
            await _invalidator.InvalidateAsync(path, ct);
        return result;
    }

    // Delegate all other methods to _inner
    public Task<StorageResult<UploadResult>> UploadAsync(UploadRequest r, CancellationToken ct = default)
        => _inner.UploadAsync(r, ct);

    // ... remaining interface methods
}
```

---

## CDN vs Presigned URLs

These two URL types serve different purposes and should not be mixed:

| URL Type | Route | Auth | Use Case |
|---|---|---|---|
| CDN URL | Storage → CDN → User | Public (or IP/token-based CDN auth) | Public media, static assets, profile images |
| Presigned URL | Storage → User (direct) | Time-limited HMAC/RSA signature | Private files, temporary access, secure downloads |

For private CDN delivery with per-user access control, use a signed CDN URL (CloudFront signed URL, Cloudflare Access token) rather than a storage presigned URL. Signed CDN URLs are cached by the CDN for other users with valid tokens; storage presigned URLs bypass the CDN entirely.

---

## Related

- [Presigned URLs](./presigned-urls.md) — Time-limited direct storage access
- [AWS S3 Provider](../providers/aws.md) — CloudFront integration
- [Azure Blob Provider](../providers/azure.md) — Azure CDN / Front Door
- [GCP Provider](../providers/gcp.md) — Cloud CDN setup
- [Download](../core/download.md) — Streaming downloads from storage
