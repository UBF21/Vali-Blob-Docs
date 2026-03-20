---
title: Observability
sidebar_label: Observability
sidebar_position: 5
---

# Observability

ValiBlob instruments all storage operations with OpenTelemetry traces and metrics using .NET's `System.Diagnostics` APIs — compatible with any OpenTelemetry backend: Jaeger, Tempo, Zipkin, Prometheus, Grafana, Datadog, Azure Monitor, and others.

---

## Telemetry Sources

| Source Type | Name | Purpose |
|---|---|---|
| `ActivitySource` | `"ValiBlob.Storage"` | Distributed tracing spans per operation |
| `Meter` | `"ValiBlob.Storage"` | Counters and histograms for metrics |

---

## OpenTelemetry Setup

```csharp
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;

builder.Services.AddOpenTelemetry()
    .WithTracing(t => t
        .AddSource("ValiBlob.Storage")
        .AddOtlpExporter()           // sends to Jaeger, Tempo, etc. via OTLP
    )
    .WithMetrics(m => m
        .AddMeter("ValiBlob.Storage")
        .AddPrometheusExporter()     // exposes /metrics for Prometheus scraping
    );
```

### Local Development with Jaeger

```bash
docker run -d --name jaeger \
    -p 16686:16686 \
    -p 4317:4317 \
    jaegertracing/all-in-one:latest
```

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t
        .AddSource("ValiBlob.Storage")
        .AddOtlpExporter(o =>
        {
            o.Endpoint = new Uri("http://localhost:4317");
            o.Protocol = OtlpExportProtocol.Grpc;
        }));
```

Open Jaeger UI at `http://localhost:16686` and filter by service `"ValiBlob.Storage"`.

---

## Traced Operations (Spans)

Every storage operation produces an `Activity` (OpenTelemetry span):

| Activity Name | Triggered By |
|---|---|
| `storage.upload` | `IStorageProvider.UploadAsync` |
| `storage.download` | `IStorageProvider.DownloadAsync` |
| `storage.delete` | `IStorageProvider.DeleteAsync` |
| `storage.exists` | `IStorageProvider.ExistsAsync` |
| `storage.copy` | `IStorageProvider.CopyAsync` |
| `storage.list` | `IStorageProvider.ListFilesAsync` / `ListFoldersAsync` |
| `storage.get_metadata` | `IStorageProvider.GetMetadataAsync` |
| `storage.set_metadata` | `IStorageProvider.SetMetadataAsync` |
| `storage.presign_upload` | `IPresignedUrlProvider.GetPresignedUploadUrlAsync` |
| `storage.presign_download` | `IPresignedUrlProvider.GetPresignedDownloadUrlAsync` |
| `storage.resumable.start` | `IResumableUploadProvider.StartResumableUploadAsync` |
| `storage.resumable.chunk` | `IResumableUploadProvider.UploadChunkAsync` |
| `storage.resumable.complete` | `IResumableUploadProvider.CompleteResumableUploadAsync` |
| `storage.resumable.abort` | `IResumableUploadProvider.AbortResumableUploadAsync` |

---

## Span Tags

Each span is enriched with contextual tags:

| Tag | Example Value | Description |
|---|---|---|
| `provider.name` | `"s3"`, `"azure"` | Registered provider name |
| `provider.type` | `"AWSS3Provider"` | Provider implementation class |
| `file.path` | `"uploads/avatar.jpg"` | Storage object path |
| `file.size_bytes` | `102400` | File size in bytes |
| `file.content_type` | `"image/jpeg"` | MIME type |
| `resumable.upload_id` | `"abc123"` | Session ID for resumable operations |
| `resumable.chunk_offset` | `5242880` | Byte offset of the chunk being uploaded |
| `error.type` | `"HttpRequestException"` | Exception type on failure |

---

## Example Trace

A single upload with thumbnail generation produces:

```
storage.upload  [85 ms]
  ├── pipeline.validation       [2 ms]
  ├── pipeline.content_detection [1 ms]
  ├── pipeline.image_processing  [20 ms]
  │     ├── image.resize         [12 ms]
  │     └── image.encode         [8 ms]
  ├── s3.put_object              [55 ms]   ← AWS SDK span
  └── storage.upload.thumbnail  [30 ms]
        ├── image.resize         [6 ms]
        └── s3.put_object        [20 ms]
```

---

## Metrics

ValiBlob emits the following metrics via `System.Diagnostics.Metrics.Meter`:

### Counters

| Metric Name | Unit | Description |
|---|---|---|
| `storage.upload.count` | `{operation}` | Total upload operations |
| `storage.download.count` | `{operation}` | Total download operations |
| `storage.delete.count` | `{operation}` | Total delete operations |
| `storage.error.count` | `{error}` | Total failed operations |
| `storage.resumable.session.count` | `{session}` | Resumable upload sessions started |
| `storage.resumable.chunk.count` | `{chunk}` | Total chunks uploaded |

### Histograms

| Metric Name | Unit | Description |
|---|---|---|
| `storage.upload.bytes` | `By` | Bytes uploaded per operation |
| `storage.download.bytes` | `By` | Bytes downloaded per operation |
| `storage.upload.duration` | `ms` | Upload operation duration |
| `storage.download.duration` | `ms` | Download operation duration |
| `storage.resumable.chunk.bytes` | `By` | Bytes per chunk upload |

All metrics include a `provider_name` dimension for per-provider segmentation.

---

## Prometheus Scraping

With `AddPrometheusExporter()`, metrics are exposed at the `/metrics` endpoint:

```
# HELP storage_upload_count Total number of upload operations
# TYPE storage_upload_count counter
storage_upload_count{provider_name="s3"} 1423

# HELP storage_upload_bytes_total Bytes uploaded total
# TYPE storage_upload_bytes_total counter
storage_upload_bytes_total{provider_name="s3"} 1073741824

# HELP storage_upload_duration_ms Upload duration
# TYPE storage_upload_duration_ms histogram
storage_upload_duration_ms_bucket{provider_name="s3",le="100"} 1200
storage_upload_duration_ms_bucket{provider_name="s3",le="500"} 1380
storage_upload_duration_ms_bucket{provider_name="s3",le="1000"} 1420
storage_upload_duration_ms_bucket{provider_name="s3",le="+Inf"} 1423

# HELP storage_error_count Total failed operations
# TYPE storage_error_count counter
storage_error_count{provider_name="s3",error_type="TimeoutException"} 3
```

Configure Prometheus to scrape:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: my-app
    static_configs:
      - targets: ['myapp:8080']
    metrics_path: /metrics
    scrape_interval: 15s
```

---

## Grafana Dashboard Queries

Example PromQL for a ValiBlob Grafana dashboard:

```promql
# Upload throughput (MB/s)
rate(storage_upload_bytes_total[5m]) / 1024 / 1024

# Download throughput (MB/s)
rate(storage_download_bytes_total[5m]) / 1024 / 1024

# Error rate per minute
rate(storage_error_count[1m]) * 60

# P50 / P95 / P99 upload latency
histogram_quantile(0.50, rate(storage_upload_duration_ms_bucket[5m]))
histogram_quantile(0.95, rate(storage_upload_duration_ms_bucket[5m]))
histogram_quantile(0.99, rate(storage_upload_duration_ms_bucket[5m]))

# Error rate by provider
sum by (provider_name) (rate(storage_error_count[5m]))
```

---

## Structured Logging

ValiBlob emits structured log messages through `ILogger<T>`. Configure the log level:

```json
{
  "Logging": {
    "LogLevel": {
      "ValiBlob": "Information"
    }
  }
}
```

| Log Level | What Is Logged |
|---|---|
| `Information` | Upload/download start and completion, provider initialization |
| `Warning` | Retry attempts, circuit breaker state changes |
| `Error` | Operation failures after all retries exhausted |
| `Debug` | Per-chunk details for resumable uploads, pipeline step execution |

---

## Custom Activity Enrichment

Attach additional tags to all ValiBlob spans by implementing `IStorageTelemetryEnricher`:

```csharp
public class TenantTelemetryEnricher : IStorageTelemetryEnricher
{
    private readonly IHttpContextAccessor _http;

    public TenantTelemetryEnricher(IHttpContextAccessor http) => _http = http;

    public void Enrich(Activity activity, StorageOperationContext context)
    {
        var tenantId = _http.HttpContext?.User.FindFirstValue("tenant_id");
        if (tenantId is not null)
        {
            activity.SetTag("tenant.id", tenantId);
            activity.SetTag("tenant.provider", context.ProviderName);
        }
    }
}

// Registration
builder.Services.AddSingleton<IStorageTelemetryEnricher, TenantTelemetryEnricher>();
```

---

## Azure Monitor / Application Insights

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t
        .AddSource("ValiBlob.Storage")
        .AddAzureMonitorTraceExporter(o =>
            o.ConnectionString = config["ApplicationInsights:ConnectionString"]!))
    .WithMetrics(m => m
        .AddMeter("ValiBlob.Storage")
        .AddAzureMonitorMetricExporter(o =>
            o.ConnectionString = config["ApplicationInsights:ConnectionString"]!));
```

ValiBlob traces appear in Application Insights under **Investigate** → **Performance**, and metrics appear in **Metrics Explorer** under the namespace `ValiBlob.Storage`.

---

## Datadog

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(t => t
        .AddSource("ValiBlob.Storage")
        .AddOtlpExporter(o =>
        {
            o.Endpoint = new Uri("http://datadog-agent:4317");
            o.Protocol = OtlpExportProtocol.Grpc;
        }))
    .WithMetrics(m => m
        .AddMeter("ValiBlob.Storage")
        .AddOtlpExporter(o =>
        {
            o.Endpoint = new Uri("http://datadog-agent:4317");
            o.Protocol = OtlpExportProtocol.Grpc;
        }));
```

Set `DD_ENV`, `DD_SERVICE`, and `DD_VERSION` environment variables so Datadog APM correlates traces across services correctly.

---

## Related

- [Resilience](./resilience.md) — Retry, circuit breaker, and timeout configuration
- [Health Checks](./health-checks.md) — ASP.NET Core health check integration
- [Events](../core/events.md) — Application-level storage event handling
