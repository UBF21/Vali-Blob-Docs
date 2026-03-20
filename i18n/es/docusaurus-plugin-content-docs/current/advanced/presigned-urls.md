---
title: URLs Prefirmadas
sidebar_label: URLs Prefirmadas
---

# URLs Prefirmadas

Las URLs prefirmadas son URLs temporales que dan acceso a un archivo específico sin requerir autenticación del proveedor de almacenamiento. Son útiles para compartir archivos privados con límite de tiempo o para permitir subidas directas desde el navegador sin pasar por el servidor.

## IPresignedUrlProvider

```csharp
public interface IPresignedUrlProvider
{
    /// <summary>Genera una URL temporal para descargar un archivo privado.</summary>
    Task<StorageResult<string>> GetPresignedDownloadUrlAsync(
        string path,
        TimeSpan expiry,
        CancellationToken ct = default);

    /// <summary>Genera una URL temporal para subir un archivo directamente al proveedor.</summary>
    Task<StorageResult<PresignedUploadUrl>> GetPresignedUploadUrlAsync(
        PresignedUploadRequest request,
        CancellationToken ct = default);
}

public class PresignedUploadRequest
{
    public required string Path { get; set; }
    public required TimeSpan Expiry { get; set; }
    public string? ContentType { get; set; }
    public long? MaxSizeBytes { get; set; }
}

public class PresignedUploadUrl
{
    public required string Url { get; set; }
    public required Dictionary<string, string> Fields { get; set; }  // Campos para POST form (S3)
    public required DateTimeOffset ExpiresAt { get; init; }
}
```

## Soporte por proveedor

| Proveedor | Descarga prefirmada | Subida prefirmada | TTL máximo |
|---|---|---|---|
| Amazon S3 | Sí | Sí | 7 días |
| Azure Blob Storage | Sí (SAS) | Sí (SAS) | Sin límite fijo |
| Google Cloud Storage | Sí | Sí | 7 días |
| OCI Object Storage | Sí | Sí | Sin límite fijo |
| Supabase Storage | Sí | Sí | Sin límite fijo |
| Local | No | No | N/A |

## URL prefirmada de descarga

```csharp
app.MapGet("/api/archivos/{*ruta}/enlace-descarga", async (
    string ruta,
    [FromQuery] int minutos,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var rutaDecodificada = Uri.UnescapeDataString(ruta);

    if (storage is not IPresignedUrlProvider presigned)
        return Results.Problem("El proveedor no soporta URLs prefirmadas.", statusCode: 501);

    var tiempoValido = TimeSpan.FromMinutes(Math.Clamp(minutos, 1, 1440)); // 1 min a 24 hs

    var resultado = await presigned.GetPresignedDownloadUrlAsync(
        rutaDecodificada, tiempoValido, ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            url = resultado.Value,
            expiraEn = DateTimeOffset.UtcNow.Add(tiempoValido),
            validoPorMinutos = tiempoValido.TotalMinutes
        })
        : resultado.ErrorCode == StorageErrorCode.NotFound
            ? Results.NotFound()
            : Results.StatusCode(500);
}).RequireAuthorization();
```

## URL prefirmada de subida (PUT directo al proveedor)

Permite al cliente subir archivos directamente a S3/Azure/GCS sin que los datos pasen por el servidor:

```csharp
// Servidor: generar URL de subida
app.MapPost("/api/uploads/url-firmada", async (
    [FromBody] SolicitudUrlFirmada solicitud,
    IStorageProvider storage,
    ClaimsPrincipal usuario,
    CancellationToken ct) =>
{
    if (storage is not IPresignedUrlProvider presigned)
        return Results.Problem("No soportado por el proveedor actual.", statusCode: 501);

    var userId = usuario.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var ruta = StoragePath.From("uploads", userId, StoragePath.Sanitize(solicitud.NombreArchivo));

    var resultado = await presigned.GetPresignedUploadUrlAsync(new PresignedUploadRequest
    {
        Path = ruta,
        Expiry = TimeSpan.FromMinutes(30),
        ContentType = solicitud.TipoContenido,
        MaxSizeBytes = 100_000_000  // 100 MB
    }, ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            url = resultado.Value!.Url,
            campos = resultado.Value.Fields,  // Campos adicionales para S3 POST form
            expiraEn = resultado.Value.ExpiresAt,
            rutaFinal = ruta
        })
        : Results.StatusCode(500);
}).RequireAuthorization();
```

```javascript
// Cliente: subir directamente al proveedor sin pasar por el servidor
async function subirDirecto(archivo) {
    // 1. Obtener URL firmada del servidor
    const resp = await fetch('/api/uploads/url-firmada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombreArchivo: archivo.name,
            tipoContenido: archivo.type
        })
    });
    const { url, rutaFinal } = await resp.json();

    // 2. Subir directamente al proveedor de nube (S3, Azure, GCS)
    await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': archivo.type },
        body: archivo
    });

    console.log(`Archivo almacenado en: ${rutaFinal}`);
    return rutaFinal;
}
```

## Galería de imágenes con URLs temporales

```csharp
app.MapGet("/api/galeria", async (
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var archivos = await storage.ListFilesAsync("galeria/", ct);
    if (!archivos.IsSuccess) return Results.StatusCode(500);

    var presigned = storage as IPresignedUrlProvider;
    var expiry = TimeSpan.FromHours(1);

    var items = await Task.WhenAll(archivos.Value!.Select(async archivo =>
    {
        string? url = null;

        if (presigned is not null)
        {
            var urlResult = await presigned.GetPresignedDownloadUrlAsync(
                archivo.Path, expiry, ct);
            url = urlResult.IsSuccess ? urlResult.Value : null;
        }

        return new
        {
            ruta = archivo.Path,
            url,
            tamanoBytes = archivo.SizeBytes,
            ultimaModificacion = archivo.LastModified
        };
    }));

    return Results.Ok(new
    {
        items,
        urlsExpiranEn = DateTimeOffset.UtcNow.Add(expiry)
    });
});
```

## Documentos privados con registro de acceso

```csharp
public class ServicioDocumentosPrivados(
    IStorageProvider storage,
    IRegistroAccesoService registro)
{
    public async Task<string?> GenerarEnlaceAsync(
        string documentoId,
        string usuarioId,
        CancellationToken ct)
    {
        if (storage is not IPresignedUrlProvider presigned)
            return null;

        var resultado = await presigned.GetPresignedDownloadUrlAsync(
            $"documentos/{documentoId}",
            TimeSpan.FromMinutes(15),
            ct);

        if (!resultado.IsSuccess) return null;

        // Registrar el acceso para auditoría
        await registro.RegistrarAsync(new RegistroAcceso
        {
            DocumentoId = documentoId,
            UsuarioId = usuarioId,
            Accion = "ENLACE_GENERADO",
            Timestamp = DateTimeOffset.UtcNow
        }, ct);

        return resultado.Value;
    }
}
```

:::tip Consejo
Para archivos que se comparten frecuentemente, genera URLs prefirmadas con TTL corto (15–60 minutos) y renuévalas automáticamente en el cliente cuando estén próximas a expirar. Esto limita la ventana de exposición si una URL cae en manos equivocadas.
:::

:::warning Advertencia
Las URLs prefirmadas no son secretos de alta seguridad: cualquiera que tenga la URL puede acceder al archivo durante el período de validez, sin importar su identidad. No las uses para documentos que requieren control de acceso estricto por identidad de usuario. Para esos casos, usa un endpoint proxy con autenticación y autorización completas.
:::
