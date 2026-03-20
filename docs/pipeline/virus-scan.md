---
title: Virus Scan Middleware
sidebar_label: Virus Scan
---

# Virus Scan Middleware

`VirusScanMiddleware` scans uploaded file content for malware using a pluggable `IVirusScanner` interface. If a threat is detected, the upload is rejected and returns `StorageResult.Failure` with `StorageErrorCode.VirusScanFailed` and the threat name in `ErrorMessage`. No infected bytes reach the storage provider.

---

## Registration

```csharp
.WithPipeline(p => p
    .UseValidation(v => { /* ... */ })
    .UseContentTypeDetection()
    .UseVirusScan()          // uses IVirusScanner resolved from DI
    // --- or with options ---
    .UseVirusScan(o =>
    {
        o.FailOnScannerUnavailable = true;   // fail closed if scanner is unreachable
        o.ScanTimeoutSeconds       = 30;      // timeout per scan
    })
)

// Register your IVirusScanner implementation
builder.Services.AddSingleton<IVirusScanner, ClamAvVirusScanner>();
```

---

## IVirusScanner Interface

```csharp
public interface IVirusScanner
{
    Task<VirusScanResult> ScanAsync(
        Stream content,
        CancellationToken ct = default);
}

public sealed record VirusScanResult
{
    public bool    IsClean    { get; init; }   // true = no threat detected
    public string? ThreatName { get; init; }   // populated when IsClean = false
    public string? Scanner    { get; init; }   // optional: scanner name/version for audit
}
```

---

## VirusScanOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `FailOnScannerUnavailable` | `bool` | `true` | If `true` (fail closed), reject the upload when the scanner cannot be reached. If `false` (fail open), allow the upload when the scanner is down |
| `ScanTimeoutSeconds` | `int` | `60` | Maximum seconds to wait for a scan result before treating it as a scanner error |

:::warning Fail open vs fail closed
Setting `FailOnScannerUnavailable = false` means infected files can reach storage if the scanner is unavailable. Only use this in non-critical, low-trust environments. In production, always fail closed (`true`) and configure alerting for scanner availability.
:::

---

## Built-in No-Op Scanner

ValiBlob includes a `NoOpVirusScanner` that always returns `IsClean = true`. This is the default when no `IVirusScanner` is registered. It is suitable for development environments where you want the middleware registered but no actual scanning:

```csharp
// Explicit no-op registration for development
builder.Services.AddSingleton<IVirusScanner, NoOpVirusScanner>();
```

---

## ClamAV Integration

[ClamAV](https://www.clamav.net/) is an open-source antivirus engine available as a Docker container or system daemon. It communicates over a TCP socket using the CLAMD protocol.

### Install the nClam client package

```bash
dotnet add package nClam
```

### ClamAV implementation

```csharp
using nClam;

public class ClamAvVirusScanner : IVirusScanner
{
    private readonly ClamClient _client;
    private readonly ILogger<ClamAvVirusScanner> _logger;

    public ClamAvVirusScanner(
        IOptions<ClamAvOptions> options,
        ILogger<ClamAvVirusScanner> logger)
    {
        _client = new ClamClient(options.Value.Host, options.Value.Port);
        _logger = logger;
    }

    public async Task<VirusScanResult> ScanAsync(Stream content, CancellationToken ct)
    {
        try
        {
            var result = await _client.SendAndScanFileAsync(content);

            return result.Result switch
            {
                ClamScanResults.Clean =>
                    new VirusScanResult { IsClean = true, Scanner = "ClamAV" },

                ClamScanResults.VirusDetected =>
                    new VirusScanResult
                    {
                        IsClean    = false,
                        ThreatName = result.InfectedFiles?.FirstOrDefault()?.VirusName
                                     ?? "Unknown threat",
                        Scanner    = "ClamAV"
                    },

                ClamScanResults.Error =>
                    throw new VirusScanException("ClamAV returned an error result."),

                _ =>
                    throw new VirusScanException($"Unexpected ClamAV result: {result.Result}")
            };
        }
        catch (Exception ex) when (ex is not VirusScanException)
        {
            _logger.LogError(ex, "ClamAV scan failed with an unexpected exception");

            // Re-throw as VirusScanException — the middleware will handle this
            // based on FailOnScannerUnavailable setting
            throw new VirusScanException("Virus scanner is unavailable.", ex);
        }
    }
}

public sealed class ClamAvOptions
{
    public string Host { get; set; } = "localhost";
    public int    Port { get; set; } = 3310;
}
```

Register:

```csharp
builder.Services.Configure<ClamAvOptions>(o =>
{
    o.Host = config["ClamAV:Host"] ?? "localhost";
    o.Port = int.Parse(config["ClamAV:Port"] ?? "3310");
});

builder.Services.AddSingleton<IVirusScanner, ClamAvVirusScanner>();
```

### ClamAV Docker setup

For local development and CI:

```bash
docker run -d \
  --name clamav \
  -p 3310:3310 \
  clamav/clamav:stable
```

Wait for ClamAV to initialize (it downloads virus signatures on first start):

```bash
docker logs -f clamav | grep "Clamd successfully"
```

For Kubernetes, run ClamAV as a sidecar container in your API pod or as a shared cluster-level service.

---

## VirusTotal Integration

[VirusTotal](https://www.virustotal.com/) offers cloud-based malware analysis against 70+ antivirus engines. Suitable for lower-volume scenarios where infrastructure overhead is undesirable.

```csharp
public class VirusTotalScanner : IVirusScanner
{
    private readonly HttpClient _http;
    private readonly string     _apiKey;
    private readonly ILogger<VirusTotalScanner> _logger;

    public VirusTotalScanner(
        IHttpClientFactory factory,
        IConfiguration config,
        ILogger<VirusTotalScanner> logger)
    {
        _http   = factory.CreateClient("virustotal");
        _apiKey = config["VirusTotal:ApiKey"]!;
        _logger = logger;
    }

    public async Task<VirusScanResult> ScanAsync(Stream content, CancellationToken ct)
    {
        // Step 1: Upload file to VirusTotal for analysis
        using var form = new MultipartFormDataContent();
        form.Add(new StreamContent(content), "file", "upload");

        using var uploadRequest = new HttpRequestMessage(HttpMethod.Post,
            "https://www.virustotal.com/api/v3/files");
        uploadRequest.Headers.Add("x-apikey", _apiKey);
        uploadRequest.Content = form;

        var uploadResponse = await _http.SendAsync(uploadRequest, ct);
        uploadResponse.EnsureSuccessStatusCode();

        var uploadBody = await uploadResponse.Content.ReadFromJsonAsync<VirusTotalUploadResponse>(ct);
        var analysisId = uploadBody!.Data.Id;

        _logger.LogInformation("VirusTotal analysis ID: {Id}", analysisId);

        // Step 2: Poll for analysis completion
        for (int attempt = 0; attempt < 30; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(3), ct);

            using var statusRequest = new HttpRequestMessage(HttpMethod.Get,
                $"https://www.virustotal.com/api/v3/analyses/{analysisId}");
            statusRequest.Headers.Add("x-apikey", _apiKey);

            var statusResponse = await _http.SendAsync(statusRequest, ct);
            statusResponse.EnsureSuccessStatusCode();

            var status = await statusResponse.Content.ReadFromJsonAsync<VirusTotalAnalysisResponse>(ct);

            if (status!.Data.Attributes.Status == "completed")
            {
                var malicious = status.Data.Attributes.Stats.Malicious;
                return new VirusScanResult
                {
                    IsClean    = malicious == 0,
                    ThreatName = malicious > 0
                        ? $"{malicious} engine(s) detected a threat"
                        : null,
                    Scanner    = "VirusTotal"
                };
            }
        }

        throw new VirusScanException("VirusTotal analysis did not complete within the timeout period.");
    }

    // Response DTOs omitted for brevity
    private record VirusTotalUploadResponse(VirusTotalData Data);
    private record VirusTotalData(string Id, VirusTotalAttributes Attributes);
    private record VirusTotalAttributes(string Status, VirusTotalStats Stats);
    private record VirusTotalStats(int Malicious);
    private record VirusTotalAnalysisResponse(VirusTotalData Data);
}
```

:::warning VirusTotal and data privacy
Files uploaded to VirusTotal become accessible to VirusTotal's partners and researchers. Do **not** use VirusTotal for files containing personally identifiable information (PII), medical records, financial data, legal documents, or any confidential content. Use ClamAV for privacy-sensitive applications.
:::

---

## Handling Scan Results in Your API

```csharp
var result = await provider.UploadAsync(new UploadRequest
{
    Path    = StoragePath.From("uploads", StoragePath.Sanitize(file.FileName)),
    Content = file.OpenReadStream()
});

if (result.IsSuccess)
    return Results.Ok(new { url = result.Value.Url });

return result.ErrorCode switch
{
    StorageErrorCode.VirusScanFailed =>
        Results.UnprocessableEntity(new
        {
            error   = "The uploaded file was rejected because it contains malware.",
            threat  = result.ErrorMessage,
            action  = "Please do not attempt to upload this file again."
        }),

    StorageErrorCode.ValidationFailed =>
        Results.BadRequest(result.ErrorMessage),

    _ =>
        Results.Problem(result.ErrorMessage, statusCode: 500)
};
```

### Security event logging

```csharp
if (result.ErrorCode == StorageErrorCode.VirusScanFailed)
{
    _logger.LogWarning(
        "Malware detected in upload from user {UserId} at {Ip}: {Threat}",
        currentUserId,
        httpContext.Connection.RemoteIpAddress,
        result.ErrorMessage);

    await _securityAlerts.RaiseAsync(new MalwareDetectedAlert
    {
        UserId    = currentUserId,
        ThreatName = result.ErrorMessage,
        FilePath   = request.Path,
        Timestamp  = DateTimeOffset.UtcNow,
        IpAddress  = httpContext.Connection.RemoteIpAddress?.ToString()
    });
}
```

---

## Performance Considerations

Virus scanning adds latency proportional to file size and scanner throughput:

| File size | ClamAV (local daemon) | VirusTotal (cloud API) |
|---|---|---|
| 1 MB | ~50–100 ms | 5–15 s |
| 10 MB | ~200–400 ms | 10–30 s |
| 100 MB | ~1–3 s | 30–120 s |
| 1 GB | ~10–30 s | Not recommended |

For large file uploads where synchronous scanning is too slow, consider a two-phase approach:

1. Store the file in a **quarantine** prefix (e.g., `quarantine/{uploadId}/filename`).
2. Return a `202 Accepted` response immediately.
3. Scan asynchronously using a background job or message queue.
4. On clean result: move the file to the final destination prefix.
5. On infected result: delete the quarantined file and notify the user.

This architecture requires changes beyond the synchronous pipeline and is covered in the Advanced section.

---

## Related

- [Validation](./validation.md) — Reject by extension and content-type before scanning
- [Content-Type Detection](./content-type-detection.md) — Identify file type before scanning
- [Pipeline Overview](./overview.md) — Middleware ordering
- [StorageResult](../core/storage-result.md) — Handling `StorageErrorCode.VirusScanFailed`
