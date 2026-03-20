---
title: Sistema de Archivos Local
sidebar_label: Local
---

# Proveedor de Sistema de Archivos Local

`ValiBlob.Local` almacena archivos en el sistema de archivos local. Es el proveedor recomendado para desarrollo, pruebas de integración y aplicaciones que corren en un único servidor sin requisitos de alta disponibilidad.

## Instalación

```bash
dotnet add package ValiBlob.Local
```

## LocalStorageOptions

```csharp
public class LocalStorageOptions
{
    /// <summary>Directorio raíz donde se almacenan los archivos. Requerido.</summary>
    public required string BasePath { get; set; }

    /// <summary>Crear el directorio si no existe al iniciar.</summary>
    public bool CreateIfNotExists { get; set; } = true;

    /// <summary>URL base para generar URLs públicas de los archivos.</summary>
    public string? PublicBaseUrl { get; set; }
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `BasePath` | — | Directorio raíz para todos los archivos. Requerido. |
| `CreateIfNotExists` | `true` | Crear el directorio automáticamente si no existe. |
| `PublicBaseUrl` | `null` | URL base para generar la propiedad `Url` en `UploadResult`. |

## Configuración básica

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "local")
    .AddProvider<LocalStorageProvider>("local", opts =>
    {
        opts.BasePath = "./storage";
        opts.CreateIfNotExists = true;
        opts.PublicBaseUrl = "https://localhost:5001/archivos";
    });
```

### Con ruta absoluta

```csharp
opts.BasePath = Path.Combine(
    builder.Environment.ContentRootPath,
    "storage");
```

### Desde configuración (appsettings.json)

```json
{
  "Storage": {
    "Local": {
      "BasePath": "./storage",
      "PublicBaseUrl": "http://localhost:5000/archivos"
    }
  }
}
```

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "local")
    .AddProvider<LocalStorageProvider>("local",
        builder.Configuration.GetSection("Storage:Local").Bind);
```

## Servir archivos estáticos con ASP.NET Core

Para que las URLs generadas sean accesibles en el navegador:

```csharp
var app = builder.Build();

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        Path.Combine(builder.Environment.ContentRootPath, "storage")),
    RequestPath = "/archivos"
});
```

Con esta configuración:
- Archivo almacenado en `./storage/uploads/foto.jpg`
- URL generada: `http://localhost:5000/archivos/uploads/foto.jpg`

## Estructura de archivos en disco

Para cada archivo subido, el proveedor local crea el archivo de datos y un archivo sidecar de metadatos:

```
storage/
├── uploads/
│   ├── documento.pdf
│   └── documento.pdf.meta.json
├── imagenes/
│   ├── foto.jpg
│   └── foto.jpg.meta.json
└── .chunks/               ← Chunks temporales de subidas reanudables
    └── {sessionId}/
        ├── 0.chunk
        ├── 1.chunk
        └── session.json
```

### Archivo sidecar de metadatos

```json
{
  "path": "uploads/documento.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 102400,
  "createdAt": "2024-03-15T10:30:00Z",
  "lastModified": "2024-03-15T10:30:00Z",
  "isEncrypted": false,
  "isCompressed": false,
  "contentHash": null,
  "tags": ["documento", "legal"],
  "customMetadata": {
    "cliente-id": "12345",
    "version": "2"
  }
}
```

## Generación de URLs

La URL generada combina `PublicBaseUrl` con la ruta del archivo:

```csharp
opts.PublicBaseUrl = "https://mi-app.com/archivos";

var resultado = await storage.UploadAsync(new UploadRequest
{
    Path = "uploads/foto.jpg",
    Content = stream,
    // ...
}, ct);

Console.WriteLine(resultado.Value!.Url);
// → "https://mi-app.com/archivos/uploads/foto.jpg"
```

Si no se configura `PublicBaseUrl`, la propiedad `Url` en `UploadResult` será `null`.

## Ejemplo completo: API de desarrollo

```csharp
using ValiBlob.Core;
using ValiBlob.Core.Extensions;
using ValiBlob.Local;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

var storagePath = Path.Combine(builder.Environment.ContentRootPath, "storage");

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "local")
    .AddProvider<LocalStorageProvider>("local", opts =>
    {
        opts.BasePath = storagePath;
        opts.CreateIfNotExists = true;
        opts.PublicBaseUrl = $"{builder.Configuration["App:BaseUrl"]}/archivos";
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 50_000_000;
            v.BlockedExtensions = [".exe", ".bat", ".sh"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.RenameWithSuffix)
    );

var app = builder.Build();

// Servir archivos estáticos desde el directorio de almacenamiento
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(storagePath),
    RequestPath = "/archivos"
});

// API de subida
app.MapPost("/api/subir", async (
    IFormFile archivo,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    await using var stream = archivo.OpenReadStream();

    var resultado = await storage.UploadAsync(new UploadRequest
    {
        Path = StoragePath.From("uploads", StoragePath.Sanitize(archivo.FileName))
                          .WithTimestampPrefix(),
        Content = stream,
        ContentType = archivo.ContentType,
        KnownSize = archivo.Length
    }, ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            ruta = resultado.Value!.Path,
            url = resultado.Value.Url,
            tamanoBytes = resultado.Value.SizeBytes
        })
        : Results.BadRequest(new { error = resultado.ErrorCode, mensaje = resultado.ErrorMessage });
}).DisableAntiforgery();

app.Run();
```

## Usar en Docker

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app/publish .

RUN mkdir -p /app/storage
VOLUME ["/app/storage"]

ENTRYPOINT ["dotnet", "MiApp.dll"]
```

```yaml
# docker-compose.yml
services:
  miapp:
    image: miapp:latest
    volumes:
      - ./storage-data:/app/storage
    environment:
      - Storage__Local__BasePath=/app/storage
      - Storage__Local__PublicBaseUrl=https://mi-app.com/archivos
```

:::warning Advertencia
No uses `LocalStorageProvider` en producción con **más de una instancia del servidor** (escalado horizontal). Cada instancia tiene su propio sistema de archivos local, por lo que los archivos subidos a una instancia no son accesibles desde las demás. Usa un proveedor de nube (AWS S3, Azure Blob, GCP, OCI) para entornos con múltiples nodos.
:::

:::tip Consejo
Para pruebas de integración, usa una carpeta temporal para aislar los archivos de prueba:

```csharp
var dirPruebas = Path.Combine(Path.GetTempPath(), $"valiblob-test-{Guid.NewGuid():N}");
opts.BasePath = dirPruebas;
opts.CreateIfNotExists = true;
// Limpiar al finalizar las pruebas:
// Directory.Delete(dirPruebas, recursive: true);
```
:::
