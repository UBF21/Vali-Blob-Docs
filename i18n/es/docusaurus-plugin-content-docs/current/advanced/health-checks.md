---
title: Health Checks
sidebar_label: Health Checks
---

# Health Checks

`ValiBlob.HealthChecks` proporciona verificaciones de disponibilidad del proveedor de almacenamiento integradas con el sistema de health checks de ASP.NET Core. Compatible con Kubernetes, Docker y plataformas de monitoreo.

## Instalación

```bash
dotnet add package ValiBlob.HealthChecks
dotnet add package AspNetCore.HealthChecks.UI.Client  # Para respuestas JSON detalladas
```

## Configuración básica

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ });

builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        name: "almacenamiento",
        tags: ["storage", "infrastructure"],
        timeout: TimeSpan.FromSeconds(5),
        failureStatus: HealthStatus.Unhealthy);

// Endpoint simple: retorna 200 (Healthy) o 503 (Unhealthy)
app.MapHealthChecks("/health");

// Endpoint con respuesta JSON detallada
app.MapHealthChecks("/health/detail", new HealthCheckOptions
{
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
});
```

## Qué verifica el health check

El health check de ValiBlob realiza una operación de prueba ligera en el proveedor:

1. Escribe un archivo de prueba pequeño (`_valiblob_healthcheck.txt`)
2. Verifica que existe con `ExistsAsync`
3. Lee sus metadatos con `GetMetadataAsync`
4. Lo elimina con `DeleteAsync`

Si todos los pasos son exitosos y se completan dentro del timeout → `Healthy`. Si alguno falla o supera el timeout → `Unhealthy` o `Degraded` (según `failureStatus`).

## Múltiples proveedores

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ })
    .AddProvider<AzureBlobProvider>("azure-backup", opts => { /* ... */ });

builder.Services
    .AddHealthChecks()
    .AddValiBlob(
        providerName: "aws",
        name: "storage-principal",
        tags: ["storage", "primary"],
        failureStatus: HealthStatus.Unhealthy)  // Fallo crítico si S3 no responde
    .AddValiBlob(
        providerName: "azure-backup",
        name: "storage-respaldo",
        tags: ["storage", "backup"],
        failureStatus: HealthStatus.Degraded);  // El respaldo puede degradarse
```

## Separar liveness de readiness (Kubernetes)

```csharp
// Liveness: la aplicación está en ejecución (no verifica el storage)
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = _ => false  // Solo responde 200 si la app corre
});

// Readiness: la aplicación puede procesar requests (incluye storage)
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("storage")
});
```

## Configuración de probes en Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mi-app
spec:
  template:
    spec:
      containers:
        - name: mi-app
          image: mi-app:latest
          ports:
            - containerPort: 8080

          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 15
            timeoutSeconds: 10
            failureThreshold: 2
```

## Respuesta JSON detallada

```json
{
  "status": "Healthy",
  "totalDuration": "00:00:00.1234567",
  "entries": {
    "storage-principal": {
      "description": "Proveedor AWS S3 disponible. Latencia: 87ms",
      "duration": "00:00:00.0870000",
      "status": "Healthy",
      "tags": ["storage", "primary"]
    },
    "storage-respaldo": {
      "description": "Proveedor Azure Blob Storage disponible. Latencia: 134ms",
      "duration": "00:00:00.1340000",
      "status": "Healthy",
      "tags": ["storage", "backup"]
    }
  }
}
```

## Health check de cuota de almacenamiento

```csharp
public class HealthCheckCuota(IStorageQuotaService quotaService) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken ct = default)
    {
        var usado = await quotaService.GetCurrentUsageBytesAsync("global", ct);
        var limite = await quotaService.GetQuotaLimitBytesAsync("global", ct) ?? long.MaxValue;
        var porcentaje = (double)usado / limite * 100;

        var datos = new Dictionary<string, object>
        {
            ["usado_gb"] = Math.Round(usado / 1_073_741_824.0, 2),
            ["limite_gb"] = Math.Round(limite / 1_073_741_824.0, 2),
            ["porcentaje_uso"] = Math.Round(porcentaje, 1)
        };

        return porcentaje switch
        {
            >= 95 => HealthCheckResult.Unhealthy($"Cuota crítica: {porcentaje:F1}% usado", data: datos),
            >= 80 => HealthCheckResult.Degraded($"Cuota alta: {porcentaje:F1}% usado", data: datos),
            _ => HealthCheckResult.Healthy($"Cuota normal: {porcentaje:F1}% usado", data: datos)
        };
    }
}

// Registro
builder.Services.AddHealthChecks()
    .AddCheck<HealthCheckCuota>(
        "storage-cuota",
        tags: ["storage", "quota"],
        failureStatus: HealthStatus.Degraded);
```

## Dashboard de Health Checks UI

```bash
dotnet add package AspNetCore.HealthChecks.UI
dotnet add package AspNetCore.HealthChecks.UI.InMemory.Storage
```

```csharp
builder.Services
    .AddHealthChecksUI(opts =>
    {
        opts.AddHealthCheckEndpoint("Producción", "/health/detail");
        opts.SetEvaluationTimeInSeconds(30);
        opts.MaximumHistoryEntriesPerEndpoint(50);
    })
    .AddInMemoryStorage();

app.MapHealthChecksUI(opts => { opts.UIPath = "/health-ui"; });
```

Accede al dashboard en: `https://tu-app.com/health-ui`

:::tip Consejo
En Kubernetes, usa `readinessProbe` apuntando a `/health/ready` (con verificación de almacenamiento) y `livenessProbe` apuntando a `/health/live` (sin verificación de almacenamiento). Si el almacenamiento no está disponible, el pod sale de rotación pero no se reinicia, ya que reiniciar el pod no solucionaría un problema del proveedor externo.
:::
