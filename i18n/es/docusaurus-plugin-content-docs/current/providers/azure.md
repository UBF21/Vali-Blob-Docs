---
title: Azure Blob Storage
sidebar_label: Azure Blob Storage
---

# Proveedor Azure Blob Storage

`ValiBlob.Azure` proporciona integración con Azure Blob Storage. Soporta cadenas de conexión, Managed Identity y emulación local con Azurite.

## Instalación

```bash
dotnet add package ValiBlob.Azure
```

## AzureBlobOptions

```csharp
public class AzureBlobOptions
{
    public string? ConnectionString { get; set; }
    public required string ContainerName { get; set; }
    public bool CreateContainerIfNotExists { get; set; } = true;
    public bool UseManagedIdentity { get; set; } = false;
    public string? AccountName { get; set; }   // Requerido cuando UseManagedIdentity = true
    public PublicAccessType PublicAccess { get; set; } = PublicAccessType.None;
    public int TimeoutSeconds { get; set; } = 300;
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `ConnectionString` | `null` | Cadena de conexión completa de la cuenta. Alternativa a Managed Identity. |
| `ContainerName` | — | Nombre del contenedor de blobs. Requerido. |
| `CreateContainerIfNotExists` | `true` | Crear el contenedor automáticamente si no existe al iniciar. |
| `UseManagedIdentity` | `false` | Usar Managed Identity / DefaultAzureCredential en lugar de clave de cuenta. |
| `AccountName` | `null` | Nombre de la cuenta de almacenamiento. Requerido cuando `UseManagedIdentity = true`. |
| `PublicAccess` | `None` | Nivel de acceso público: `None`, `Blob`, o `BlobContainer`. |

## Configuración con cadena de conexión

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure")
    .AddProvider<AzureBlobProvider>("azure", opts =>
    {
        opts.ConnectionString = builder.Configuration["Azure:Storage:ConnectionString"]!;
        opts.ContainerName = "documentos";
        opts.CreateContainerIfNotExists = true;
    });
```

```json
{
  "Azure": {
    "Storage": {
      "ConnectionString": "DefaultEndpointsProtocol=https;AccountName=micuenta;AccountKey=CLAVE;EndpointSuffix=core.windows.net",
      "ContainerName": "documentos"
    }
  }
}
```

## Configuración con Managed Identity (recomendado en producción)

```bash
# Asignar rol al Managed Identity del App Service / AKS / VM
az role assignment create \
  --assignee <principal-id> \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<cuenta>
```

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure")
    .AddProvider<AzureBlobProvider>("azure", opts =>
    {
        opts.UseManagedIdentity = true;
        opts.AccountName = builder.Configuration["Azure:Storage:AccountName"]!;
        opts.ContainerName = "documentos";
    });
```

## Azurite para desarrollo local

```bash
# Iniciar Azurite con Docker
docker run -p 10000:10000 \
    mcr.microsoft.com/azure-storage/azurite \
    azurite-blob --blobHost 0.0.0.0
```

```csharp
// appsettings.Development.json
{
  "Azure": {
    "Storage": {
      "ConnectionString": "UseDevelopmentStorage=true",
      "ContainerName": "dev-contenedor"
    }
  }
}
```

```csharp
.AddProvider<AzureBlobProvider>("azure", opts =>
{
    opts.ConnectionString = builder.Configuration["Azure:Storage:ConnectionString"]
        ?? "UseDevelopmentStorage=true";
    opts.ContainerName = builder.Configuration["Azure:Storage:ContainerName"] ?? "uploads";
    opts.CreateContainerIfNotExists = true;
})
```

## Visibilidad del contenedor

```csharp
// Contenedor privado (por defecto): requiere SAS o Managed Identity para acceso
opts.PublicAccess = PublicAccessType.None;

// Blobs individuales accesibles públicamente por URL directa
opts.PublicAccess = PublicAccessType.Blob;

// Contenedor completo accesible (no recomendado en producción para datos sensibles)
opts.PublicAccess = PublicAccessType.BlobContainer;
```

## URLs SAS (Shared Access Signature)

Para acceso temporal a blobs privados:

```csharp
app.MapGet("/api/documentos/{*ruta}/url-temporal", async (
    string ruta,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    if (storage is not IPresignedUrlProvider presigned)
        return Results.StatusCode(501);

    var resultado = await presigned.GetPresignedDownloadUrlAsync(
        path: Uri.UnescapeDataString(ruta),
        expiry: TimeSpan.FromHours(2),
        ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            urlSas = resultado.Value,
            expiraEn = DateTime.UtcNow.AddHours(2)
        })
        : Results.NotFound();
}).RequireAuthorization();
```

## Múltiples contenedores

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure-docs")
    .AddProvider<AzureBlobProvider>("azure-docs", opts =>
    {
        opts.ConnectionString = config["Azure:Storage:ConnectionString"]!;
        opts.ContainerName = "documentos";
        opts.PublicAccess = PublicAccessType.None;
    })
    .AddProvider<AzureBlobProvider>("azure-imagenes", opts =>
    {
        opts.ConnectionString = config["Azure:Storage:ConnectionString"]!;
        opts.ContainerName = "imagenes-producto";
        opts.PublicAccess = PublicAccessType.Blob; // Imágenes públicas por URL
    });
```

```csharp
// Inyección de proveedores nombrados
public class ServicioDocumentos(
    [FromKeyedServices("azure-docs")] IStorageProvider documentos,
    [FromKeyedServices("azure-imagenes")] IStorageProvider imagenes)
{
    // Usar documentos.UploadAsync(...) para el contenedor privado
    // Usar imagenes.UploadAsync(...) para el contenedor de imágenes públicas
}
```

## Configurar CORS en Azure Storage

Para subidas directas desde el navegador:

```bash
az storage cors add \
  --services b \
  --methods GET PUT POST DELETE HEAD \
  --origins "https://mi-app.com" "http://localhost:3000" \
  --allowed-headers "*" \
  --exposed-headers "ETag" \
  --max-age 3600 \
  --account-name mi-cuenta-storage
```

## Ejemplo completo: producción con Managed Identity

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "azure")
    .AddProvider<AzureBlobProvider>("azure", opts =>
    {
        if (builder.Environment.IsProduction())
        {
            opts.UseManagedIdentity = true;
            opts.AccountName = builder.Configuration["Azure:Storage:AccountName"]!;
        }
        else
        {
            // Azurite en desarrollo local
            opts.ConnectionString = builder.Configuration["Azure:Storage:ConnectionString"]
                ?? "UseDevelopmentStorage=true";
        }

        opts.ContainerName = builder.Configuration["Azure:Storage:ContainerName"] ?? "uploads";
        opts.CreateContainerIfNotExists = true;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 100_000_000; // 100 MB
            v.BlockedExtensions = [".exe", ".bat", ".sh", ".ps1", ".dll"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.RenameWithSuffix)
    );
```

:::tip Consejo
Usa **Managed Identity** en Azure en lugar de cadenas de conexión con `AccountKey`. Managed Identity elimina la necesidad de gestionar y rotar credenciales. Solo requiere asignar el rol `Storage Blob Data Contributor` a la identidad de tu App Service, AKS Pod o Virtual Machine.
:::

:::warning Advertencia
Las cadenas de conexión de Azure Storage incluyen la `AccountKey`, que otorga acceso completo a toda la cuenta de almacenamiento. Si se expone en un repositorio o log, un atacante puede acceder y modificar todos los blobs. Guarda siempre la cadena de conexión en Azure Key Vault o en User Secrets y nunca en archivos versionados.
:::
