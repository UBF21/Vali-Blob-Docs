---
title: Health Checks
sidebar_label: Health Checks
sidebar_position: 7
---

# Health Checks

`ValiBlob.HealthChecks` integrates with ASP.NET Core's health check framework, allowing you to verify storage provider availability as part of your application's readiness and liveness probes.

---

## Installation

```bash
dotnet add package ValiBlob.Core
dotnet add package ValiBlob.HealthChecks
```

---

## How the Check Works

The ValiBlob health check calls `ExistsAsync` on a predefined canary path in your storage bucket (default: `".valiblob-health"`) on each probe. If the call completes without throwing, the check reports **Healthy** — even if `ExistsAsync` returns `false` (the canary file does not need to exist). What matters is that the provider is reachable and credentials are valid.

If the call throws or times out, the check reports the configured `failureStatus`.

---

## Basic Setup

```csharp
using ValiBlob.HealthChecks;

// Register ValiBlob providers
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts =>
    {
        opts.BucketName = config["AWS:BucketName"]!;
        opts.Region     = config["AWS:Region"]!;
    });

// Register health checks
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:          "storage-aws",
        providerName:  "aws",
        failureStatus: HealthStatus.Unhealthy,
        tags:          ["ready", "storage"],
        timeout:       TimeSpan.FromSeconds(5));

// Map health endpoint
app.MapHealthChecks("/health");
```

---

## Multiple Providers

Register a check for each provider your application depends on:

```csharp
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:          "storage-aws-primary",
        providerName:  "aws-us",
        failureStatus: HealthStatus.Unhealthy,
        tags:          ["ready", "storage"])
    .AddValiBlob(
        name:          "storage-aws-eu",
        providerName:  "aws-eu",
        failureStatus: HealthStatus.Degraded,  // secondary region — degraded, not unhealthy
        tags:          ["storage"])
    .AddValiBlob(
        name:          "storage-local-cache",
        providerName:  "local",
        failureStatus: HealthStatus.Degraded,
        tags:          ["storage"]);
```

---

## HealthStatus Behavior

| Status | HTTP Response | Use When |
|---|---|---|
| `Unhealthy` | 503 Service Unavailable | Provider is critical — the application cannot function without it |
| `Degraded` | 200 OK (with warning) | Provider is secondary or has a fallback path |
| `Healthy` | 200 OK | Only monitoring; never alert on failure |

---

## Health Check Endpoints

### Basic Endpoint

```csharp
app.MapHealthChecks("/health");
// Returns: 200 (Healthy/Degraded) or 503 (Unhealthy)
```

### JSON Response

```csharp
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using System.Text.Json;

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";

        var result = new
        {
            status        = report.Status.ToString(),
            totalDuration = report.TotalDuration.TotalMilliseconds,
            checks        = report.Entries.Select(e => new
            {
                name        = e.Key,
                status      = e.Value.Status.ToString(),
                description = e.Value.Description,
                duration    = e.Value.Duration.TotalMilliseconds,
                error       = e.Value.Exception?.Message,
                tags        = e.Value.Tags
            })
        };

        await context.Response.WriteAsync(
            JsonSerializer.Serialize(result,
                new JsonSerializerOptions { WriteIndented = true }));
    }
});
```

Example response when all checks pass:

```json
{
  "status": "Healthy",
  "totalDuration": 78.3,
  "checks": [
    {
      "name": "storage-aws-primary",
      "status": "Healthy",
      "description": "ValiBlob provider 'aws-us' is reachable.",
      "duration": 45.2,
      "error": null,
      "tags": ["ready", "storage"]
    },
    {
      "name": "storage-aws-eu",
      "status": "Healthy",
      "description": "ValiBlob provider 'aws-eu' is reachable.",
      "duration": 33.1,
      "error": null,
      "tags": ["storage"]
    }
  ]
}
```

---

## Separate Liveness and Readiness Endpoints

Kubernetes and other orchestrators use separate liveness (is the process alive?) and readiness (is the app ready to serve traffic?) probes. Separate them by tag:

```csharp
// Liveness: process is alive — no external checks needed
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false  // exclude all registered checks
});

// Readiness: storage must be reachable to accept traffic
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});

// Full report: all checks (for monitoring dashboards)
app.MapHealthChecks("/health/all");
```

---

## Kubernetes Probe Configuration

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: my-app
          image: my-app:latest
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
            failureThreshold: 2
            successThreshold: 1
```

When the readiness probe fails (storage is unreachable), Kubernetes stops routing new traffic to the pod until the check recovers.

---

## Custom Canary Path

Override the default canary path:

```csharp
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:         "storage-aws",
        providerName: "aws",
        options: new ValiBloBHealthCheckOptions
        {
            CanaryPath = ".health/canary"
        });
```

---

## Timeout Per Check

Add a per-check timeout to prevent health probes from hanging indefinitely:

```csharp
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:         "storage-aws",
        providerName: "aws",
        timeout:      TimeSpan.FromSeconds(5));  // report Unhealthy if > 5s
```

---

## Redis Session Store Check

When using the Redis session store for resumable uploads, register a separate Redis check:

```csharp
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:         "storage-aws",
        providerName: "aws",
        tags:         ["ready", "storage"])
    .AddRedis(
        config["Redis:ConnectionString"]!,
        name:    "redis-session-store",
        tags:    ["ready", "session-store"]);
```

If Redis is down while S3 is healthy, resumable uploads will fail even though `ExistsAsync` on S3 succeeds. Separate checks help pinpoint which component is unhealthy.

---

## Complete Health Check Setup

```csharp
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using ValiBlob.HealthChecks;

// Providers
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts =>
    {
        opts.BucketName = config["AWS:BucketName"]!;
        opts.Region     = config["AWS:Region"]!;
    })
    .AddRedisSessionStore(opts =>
    {
        opts.ConnectionString = config["Redis:ConnectionString"]!;
    });

// Health checks
builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name:          "storage",
        providerName:  "aws",
        failureStatus: HealthStatus.Unhealthy,
        tags:          ["ready"],
        timeout:       TimeSpan.FromSeconds(5))
    .AddRedis(
        config["Redis:ConnectionString"]!,
        name:          "redis",
        failureStatus: HealthStatus.Unhealthy,
        tags:          ["ready"],
        timeout:       TimeSpan.FromSeconds(3));

var app = builder.Build();

// Liveness (no external checks)
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false
});

// Readiness (storage + redis)
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate      = check => check.Tags.Contains("ready"),
    ResponseWriter = WriteJsonResponse
});

// Full report
app.MapHealthChecks("/health/all", new HealthCheckOptions
{
    ResponseWriter = WriteJsonResponse
});

static Task WriteJsonResponse(HttpContext ctx, HealthReport report)
{
    ctx.Response.ContentType = "application/json";
    return ctx.Response.WriteAsync(JsonSerializer.Serialize(new
    {
        status = report.Status.ToString(),
        checks = report.Entries.Select(e => new
        {
            name     = e.Key,
            status   = e.Value.Status.ToString(),
            duration = e.Value.Duration.TotalMilliseconds,
            error    = e.Value.Exception?.Message
        })
    }));
}
```

---

## Grafana Alerting

Set up an alert when the health endpoint returns non-200 (via Blackbox Exporter):

```yaml
# Prometheus alert rule
- alert: ValiBlobStorageUnhealthy
  expr: probe_success{job="valiblob-health"} == 0
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "ValiBlob storage health check failing"
    description: "Storage provider has been unreachable for 2+ minutes. Uploads and downloads may be failing."
```

---

## Related

- [Resilience](./resilience.md) — Retry and circuit breaker configuration
- [Observability](./observability.md) — OpenTelemetry traces and metrics
- [Redis Session Store](../resumable/redis-store.md) — Redis health check integration
- [Packages](../packages.md) — Full package reference
