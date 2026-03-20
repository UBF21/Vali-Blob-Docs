---
title: Observabilidad
sidebar_label: Observabilidad
---

# Observabilidad

ValiBlob instrumenta todas sus operaciones con `ActivitySource` (trazas distribuidas) y `Meter` (métricas) de `System.Diagnostics`, compatible con el estándar OpenTelemetry. Funciona con cualquier backend de observabilidad: Jaeger, Grafana Tempo, Prometheus, Datadog, Azure Monitor, etc.

## StorageTelemetry

```csharp
public static class StorageTelemetry
{
    public const string ActivitySourceName = "ValiBlob";  // Para trazas
    public const string MeterName = "ValiBlob";           // Para métricas

    // Nombres de instrumentos de métricas
    public const string UploadDurationMs  = "valiblob.upload.duration_ms";
    public const string DownloadDurationMs = "valiblob.download.duration_ms";
    public const string UploadSizeBytes   = "valiblob.upload.size_bytes";
    public const string UploadCount       = "valiblob.upload.count";
    public const string DownloadCount     = "valiblob.download.count";
    public const string ErrorCount        = "valiblob.error.count";
    public const string StorageUsageBytes = "valiblob.storage.usage_bytes";
}
```

## Actividades (trazas distribuidas)

ValiBlob crea una `Activity` por cada operación de almacenamiento:

| Actividad | Atributos incluidos |
|---|---|
| `valiblob.upload` | `storage.provider`, `storage.path`, `storage.size`, `storage.content_type` |
| `valiblob.download` | `storage.provider`, `storage.path` |
| `valiblob.delete` | `storage.provider`, `storage.path` |
| `valiblob.copy` | `storage.provider`, `storage.source_path`, `storage.destination_path` |
| `valiblob.list` | `storage.provider`, `storage.prefix` |
| `valiblob.get_metadata` | `storage.provider`, `storage.path` |
| `valiblob.pipeline.validation` | `pipeline.step`, `validation.passed` |
| `valiblob.pipeline.compression` | `pipeline.step`, `compression.ratio` |
| `valiblob.pipeline.encryption` | `pipeline.step` |

## Integración con OpenTelemetry

```bash
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Exporter.Otlp       # Jaeger, Tempo, Datadog, etc.
dotnet add package OpenTelemetry.Exporter.Prometheus.AspNetCore
```

```csharp
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService(
        serviceName: "mi-app",
        serviceVersion: "1.0.0"))
    .WithTracing(tracing => tracing
        .AddSource(StorageTelemetry.ActivitySourceName)  // ValiBlob
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri(
                builder.Configuration["OpenTelemetry:Endpoint"] ?? "http://localhost:4317");
        })
    )
    .WithMetrics(metrics => metrics
        .AddMeter(StorageTelemetry.MeterName)            // ValiBlob
        .AddAspNetCoreInstrumentation()
        .AddPrometheusExporter()
    );

// Exponer endpoint de scraping para Prometheus
app.MapPrometheusScrapingEndpoint("/metrics");
```

## Ejemplo de salida en Prometheus

```
# HELP valiblob_upload_duration_ms Duración de subidas en milisegundos
# TYPE valiblob_upload_duration_ms histogram
valiblob_upload_duration_ms_bucket{provider="aws",le="100"} 45
valiblob_upload_duration_ms_bucket{provider="aws",le="500"} 89
valiblob_upload_duration_ms_bucket{provider="aws",le="+Inf"} 100

# HELP valiblob_upload_size_bytes Tamaño de archivos subidos
# TYPE valiblob_upload_size_bytes histogram
valiblob_upload_size_bytes_sum{provider="aws"} 52428800
valiblob_upload_size_bytes_count{provider="aws"} 100

# HELP valiblob_error_count_total Total de errores por operación y código
# TYPE valiblob_error_count_total counter
valiblob_error_count_total{provider="aws",operation="upload",error_code="FileTooLarge"} 12
valiblob_error_count_total{provider="aws",operation="upload",error_code="VirusDetected"} 2
```

## Integración con Jaeger (trazas distribuidas)

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI de Jaeger
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP
```

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddSource(StorageTelemetry.ActivitySourceName)
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri(
                builder.Configuration["Jaeger:Endpoint"] ?? "http://localhost:4317");
        })
    );
```

Con esta configuración, cada request HTTP que realiza operaciones de almacenamiento genera trazas en Jaeger con los spans de ValiBlob anidados dentro del span del request HTTP.

## Paneles de Grafana

```json
// Panel: Subidas por minuto
{
  "title": "Subidas por minuto",
  "type": "timeseries",
  "targets": [{
    "expr": "rate(valiblob_upload_count_total[1m])",
    "legendFormat": "{{provider}}"
  }]
}

// Panel: Latencia P95 de subidas
{
  "title": "Latencia P95 de subidas (ms)",
  "type": "timeseries",
  "targets": [{
    "expr": "histogram_quantile(0.95, rate(valiblob_upload_duration_ms_bucket[5m]))",
    "legendFormat": "p95 — {{provider}}"
  }]
}

// Panel: Tasa de errores por código
{
  "title": "Errores de almacenamiento",
  "type": "timeseries",
  "targets": [{
    "expr": "rate(valiblob_error_count_total[5m])",
    "legendFormat": "{{error_code}} — {{operation}}"
  }]
}
```

## Alertas recomendadas (Prometheus Alerting Rules)

```yaml
groups:
  - name: valiblob
    rules:
      - alert: ErroresAlmacenamientoAltos
        expr: rate(valiblob_error_count_total{error_code=~"ProviderError|NetworkError"}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Alta tasa de errores en almacenamiento"
          description: "Más del 10% de las operaciones fallan con errores de proveedor."

      - alert: LatenciaAlta_Subidas
        expr: histogram_quantile(0.95, rate(valiblob_upload_duration_ms_bucket[5m])) > 5000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Latencia alta en subidas de archivos"
          description: "El percentil 95 de latencia de subidas supera los 5 segundos."
```

:::tip Consejo
Exporta trazas a Jaeger, Zipkin o Grafana Tempo, y métricas a Prometheus + Grafana. Esto te permite correlacionar operaciones de almacenamiento lentas con otros componentes de tu sistema (base de datos, autenticación, red) usando el `TraceId` distribuido.
:::
