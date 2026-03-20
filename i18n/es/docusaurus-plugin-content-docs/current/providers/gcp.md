---
title: Google Cloud Storage
sidebar_label: Google Cloud Storage
---

# Proveedor Google Cloud Storage

`ValiBlob.GCP` proporciona integración con Google Cloud Storage (GCS). Soporta cuentas de servicio con archivo JSON, credenciales inline en variables de entorno, y Application Default Credentials (ADC) para Cloud Run, GKE y Compute Engine.

## Instalación

```bash
dotnet add package ValiBlob.GCP
```

## GCPStorageOptions

```csharp
public class GCPStorageOptions
{
    public required string ProjectId { get; set; }
    public required string BucketName { get; set; }
    public string? JsonCredentials { get; set; }       // JSON inline de cuenta de servicio
    public string? JsonCredentialsPath { get; set; }   // Ruta al archivo .json de credenciales
    public int TimeoutSeconds { get; set; } = 300;
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `ProjectId` | — | ID del proyecto en GCP. Requerido. |
| `BucketName` | — | Nombre del bucket. Requerido. |
| `JsonCredentials` | `null` | Contenido JSON de la cuenta de servicio (inline). |
| `JsonCredentialsPath` | `null` | Ruta al archivo `.json` de credenciales. |
| `TimeoutSeconds` | `300` | Timeout para operaciones de almacenamiento. |

Si `JsonCredentials` y `JsonCredentialsPath` son `null`, el proveedor usa **Application Default Credentials** automáticamente.

## Configuración con archivo de credenciales

```bash
# Crear cuenta de servicio
gcloud iam service-accounts create valiblob-sa \
    --display-name="ValiBlob Storage Service Account" \
    --project=mi-proyecto

# Asignar rol de administrador de objetos
gcloud projects add-iam-policy-binding mi-proyecto \
    --member="serviceAccount:valiblob-sa@mi-proyecto.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"

# Descargar archivo de credenciales
gcloud iam service-accounts keys create ./credenciales-gcs.json \
    --iam-account=valiblob-sa@mi-proyecto.iam.gserviceaccount.com
```

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcs")
    .AddProvider<GCPStorageProvider>("gcs", opts =>
    {
        opts.ProjectId = builder.Configuration["GCP:ProjectId"]!;
        opts.BucketName = builder.Configuration["GCP:BucketName"]!;
        opts.JsonCredentialsPath = builder.Configuration["GCP:CredentialsPath"];
    });
```

## Configuración con credenciales como variable de entorno

```bash
# Guardar el contenido del JSON en una variable de entorno o secreto
export GCP__CredentialsJson="$(cat credenciales-gcs.json)"
```

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcs")
    .AddProvider<GCPStorageProvider>("gcs", opts =>
    {
        opts.ProjectId = builder.Configuration["GCP:ProjectId"]!;
        opts.BucketName = builder.Configuration["GCP:BucketName"]!;
        opts.JsonCredentials = builder.Configuration["GCP:CredentialsJson"];
    });
```

## Configuración con Application Default Credentials (Cloud Run, GKE, GCE)

En entornos gestionados de GCP, no se necesitan credenciales explícitas. El SDK detecta automáticamente el contexto:

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcs")
    .AddProvider<GCPStorageProvider>("gcs", opts =>
    {
        opts.ProjectId = "mi-proyecto-12345";
        opts.BucketName = "mi-bucket-produccion";
        // Sin JsonCredentials ni JsonCredentialsPath → ADC automático
    });
```

## Roles IAM requeridos

| Rol | Permisos | Cuándo usar |
|---|---|---|
| `roles/storage.objectAdmin` | CRUD completo de objetos | Aplicaciones con lectura y escritura |
| `roles/storage.objectViewer` | Solo lectura | Servicios de solo lectura |
| `roles/storage.objectCreator` | Solo creación | Servicios de ingesta de datos |

```bash
# Asignar rol al bucket específico (preferible a nivel de proyecto)
gcloud storage buckets add-iam-policy-binding gs://mi-bucket \
    --member="serviceAccount:valiblob-sa@mi-proyecto.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"
```

## URLs firmadas (Signed URLs)

```csharp
app.MapGet("/api/archivos/{*ruta}/enlace-temporal", async (
    string ruta,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    if (storage is not IPresignedUrlProvider presigned)
        return Results.StatusCode(501);

    var resultado = await presigned.GetPresignedDownloadUrlAsync(
        path: Uri.UnescapeDataString(ruta),
        expiry: TimeSpan.FromMinutes(30),
        ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            url = resultado.Value,
            expiraEn = DateTime.UtcNow.AddMinutes(30)
        })
        : Results.NotFound();
}).RequireAuthorization();
```

## Crear y configurar el bucket

```bash
# Crear bucket con acceso uniforme (recomendado)
gcloud storage buckets create gs://mi-bucket \
    --project=mi-proyecto \
    --location=southamerica-east1 \
    --uniform-bucket-level-access

# Configurar CORS para subidas directas desde el navegador
cat > cors-config.json << 'EOF'
[{
  "origin": ["https://mi-app.com", "http://localhost:3000"],
  "method": ["GET", "PUT", "POST", "DELETE", "HEAD"],
  "responseHeader": ["Content-Type", "ETag"],
  "maxAgeSeconds": 3600
}]
EOF

gcloud storage buckets update gs://mi-bucket --cors-file=cors-config.json
```

## Configuración completa en producción

```json
{
  "GCP": {
    "ProjectId": "mi-proyecto-12345",
    "BucketName": "mi-app-produccion",
    "CredentialsPath": "/run/secrets/gcp-credentials.json"
  }
}
```

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "gcs")
    .AddProvider<GCPStorageProvider>("gcs", opts =>
    {
        opts.ProjectId = builder.Configuration["GCP:ProjectId"]!;
        opts.BucketName = builder.Configuration["GCP:BucketName"]!;

        var credPath = builder.Configuration["GCP:CredentialsPath"];
        if (!string.IsNullOrEmpty(credPath) && File.Exists(credPath))
            opts.JsonCredentialsPath = credPath;
        // Si no existe el archivo → usa ADC (Cloud Run, GKE, etc.)
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 5_000_000_000L; // 5 GB
            v.BlockedExtensions = [".exe", ".bat", ".sh"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );
```

## Regiones de GCP disponibles (selección)

| Región | Identificador | Zona geográfica |
|---|---|---|
| São Paulo, Brasil | `southamerica-east1` | América del Sur |
| Santiago, Chile | `southamerica-west1` | América del Sur |
| Iowa, EEUU | `us-central1` | Norteamérica |
| Virginia, EEUU | `us-east4` | Norteamérica |
| Bélgica | `europe-west1` | Europa |
| Tokio, Japón | `asia-northeast1` | Asia-Pacífico |
| Sídney, Australia | `australia-southeast1` | Asia-Pacífico |

:::tip Consejo
En Cloud Run y GKE, usa **Workload Identity** en lugar de archivos de credenciales en contenedores. Workload Identity vincula una cuenta de servicio de Kubernetes con una cuenta de servicio de GCP, eliminando completamente la necesidad de archivos `.json` en los pods.
:::

:::warning Advertencia
Los archivos JSON de cuentas de servicio son credenciales permanentes con acceso completo a los recursos asignados. Almacénalos en Google Secret Manager, Kubernetes Secrets o tu gestor de secretos preferido. Nunca los incluyas en imágenes de Docker ni en repositorios de código.
:::
