---
title: Metadatos
sidebar_label: Metadatos
---

# Metadatos

Los metadatos permiten asociar información adicional a cada archivo almacenado: tipo de contenido, fechas, etiquetas, información de autoría, estado de flujos de trabajo y cualquier par clave-valor que necesite tu aplicación.

## Métodos disponibles

```csharp
// Obtener todos los metadatos de un archivo
Task<StorageResult<FileMetadata>> GetMetadataAsync(
    string path,
    CancellationToken ct = default);

// Reemplazar los metadatos personalizados de un archivo existente
Task<StorageResult> SetMetadataAsync(
    string path,
    Dictionary<string, string> metadata,
    CancellationToken ct = default);
```

## FileMetadata — todos los campos

```csharp
public class FileMetadata
{
    /// <summary>Ruta del archivo en el almacenamiento.</summary>
    public required string Path { get; init; }

    /// <summary>Tamaño del archivo almacenado en bytes (puede diferir del original si está comprimido).</summary>
    public long SizeBytes { get; init; }

    /// <summary>Tipo MIME del archivo.</summary>
    public string? ContentType { get; init; }

    /// <summary>Fecha y hora de creación del archivo.</summary>
    public DateTimeOffset? CreatedAt { get; init; }

    /// <summary>Fecha y hora de la última modificación.</summary>
    public DateTimeOffset? LastModified { get; init; }

    /// <summary>Hash ETag del archivo (formato depende del proveedor).</summary>
    public string? ETag { get; init; }

    /// <summary>Metadatos personalizados definidos al subir o con SetMetadataAsync.</summary>
    public IReadOnlyDictionary<string, string> CustomMetadata { get; init; }
        = new Dictionary<string, string>();

    /// <summary>Etiquetas del archivo para búsqueda y clasificación.</summary>
    public IReadOnlyList<string> Tags { get; init; } = [];

    /// <summary>true si el archivo fue cifrado con EncryptionMiddleware.</summary>
    public bool IsEncrypted { get; init; }

    /// <summary>true si el archivo fue comprimido con CompressionMiddleware.</summary>
    public bool IsCompressed { get; init; }

    /// <summary>Hash SHA-256 del contenido original (disponible si se usó deduplicación).</summary>
    public string? ContentHash { get; init; }
}
```

### Descripción de campos

| Campo | Tipo | Descripción |
|---|---|---|
| `Path` | `string` | Ruta completa del archivo |
| `SizeBytes` | `long` | Tamaño en bytes del archivo almacenado |
| `ContentType` | `string?` | Tipo MIME. Ej: `image/jpeg`, `application/pdf` |
| `CreatedAt` | `DateTimeOffset?` | Fecha de creación (no todos los proveedores la devuelven) |
| `LastModified` | `DateTimeOffset?` | Fecha de última modificación |
| `ETag` | `string?` | Hash de integridad según el proveedor |
| `CustomMetadata` | `IReadOnlyDictionary<string,string>` | Metadatos personalizados |
| `Tags` | `IReadOnlyList<string>` | Etiquetas para clasificación |
| `IsEncrypted` | `bool` | `true` si fue cifrado con `EncryptionMiddleware` |
| `IsCompressed` | `bool` | `true` si fue comprimido con `CompressionMiddleware` |
| `ContentHash` | `string?` | SHA-256 del contenido original |

## GetMetadataAsync

### Uso básico

```csharp
var resultado = await storage.GetMetadataAsync("documentos/contrato.pdf", ct);

if (resultado.IsSuccess)
{
    var meta = resultado.Value!;
    Console.WriteLine($"Archivo: {meta.Path}");
    Console.WriteLine($"Tamaño: {meta.SizeBytes / 1024.0:F2} KB");
    Console.WriteLine($"Tipo MIME: {meta.ContentType}");
    Console.WriteLine($"Creado: {meta.CreatedAt:R}");
    Console.WriteLine($"Modificado: {meta.LastModified:R}");
    Console.WriteLine($"Cifrado: {meta.IsEncrypted}");
    Console.WriteLine($"Comprimido: {meta.IsCompressed}");

    foreach (var (clave, valor) in meta.CustomMetadata)
        Console.WriteLine($"  {clave}: {valor}");
}
```

### En un endpoint de información de archivo

```csharp
app.MapGet("/api/archivos/{*ruta}/info", async (
    string ruta,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var resultado = await storage.GetMetadataAsync(Uri.UnescapeDataString(ruta), ct);

    if (!resultado.IsSuccess)
    {
        return resultado.ErrorCode == StorageErrorCode.NotFound
            ? Results.NotFound()
            : Results.StatusCode(500);
    }

    var meta = resultado.Value!;
    return Results.Ok(new
    {
        ruta = meta.Path,
        tamanoBytes = meta.SizeBytes,
        tamanoMb = Math.Round(meta.SizeBytes / 1024.0 / 1024.0, 2),
        tipoContenido = meta.ContentType,
        creadoEn = meta.CreatedAt,
        modificadoEn = meta.LastModified,
        estaCifrado = meta.IsEncrypted,
        estaComprimido = meta.IsCompressed,
        etiquetas = meta.Tags,
        metadatos = meta.CustomMetadata
    });
});
```

## SetMetadataAsync

Reemplaza **todos** los metadatos personalizados del archivo. No es una operación de merge parcial.

### Uso básico

```csharp
var resultado = await storage.SetMetadataAsync(
    path: "contratos/contrato-001.pdf",
    metadata: new Dictionary<string, string>
    {
        ["estado"] = "firmado",
        ["firmado-por"] = "Ana García",
        ["fecha-firma"] = DateTimeOffset.UtcNow.ToString("O"),
        ["version"] = "final",
        ["revisado-por-juridico"] = "true"
    },
    ct);

if (!resultado.IsSuccess)
    logger.LogError("Error al actualizar metadatos: {Mensaje}", resultado.ErrorMessage);
```

### Actualización parcial (merge manual)

Como `SetMetadataAsync` reemplaza todos los metadatos, implementa el merge manualmente cuando solo necesitas actualizar algunos campos:

```csharp
public async Task ActualizarMetadatosParciales(
    IStorageProvider storage,
    string ruta,
    Dictionary<string, string> nuevosCampos,
    CancellationToken ct)
{
    var metaActual = await storage.GetMetadataAsync(ruta, ct);
    if (!metaActual.IsSuccess) return;

    // Merge: combinar los metadatos existentes con los nuevos
    var metadatos = metaActual.Value!.CustomMetadata
        .ToDictionary(kv => kv.Key, kv => kv.Value);

    foreach (var (clave, valor) in nuevosCampos)
        metadatos[clave] = valor;

    await storage.SetMetadataAsync(ruta, metadatos, ct);
}
```

## Soporte por proveedor

| Proveedor | Metadatos personalizados | Límite por clave | Límite total |
|---|---|---|---|
| Amazon S3 | Sí | 2 KB por par | 2 KB total |
| Azure Blob Storage | Sí | 8 KB total | Sin límite fijo |
| Google Cloud Storage | Sí | Sin límite documentado | Sin límite fijo |
| OCI Object Storage | Sí | Sin límite documentado | Sin límite fijo |
| Supabase Storage | Sí | Limitado por la BD | Sin límite fijo |
| Sistema de archivos local | Sí | Sin límite (JSON) | Sin límite |

:::warning Advertencia
Amazon S3 tiene un límite estricto de **2 KB totales** para todos los metadatos de un objeto. Si necesitas almacenar más información, considera guardar los metadatos extendidos en una base de datos usando la ruta del archivo como clave primaria, o serializa los datos en un único campo JSON comprimido.
:::

## Casos de uso prácticos

### Sistema de auditoría de acceso

```csharp
// Al subir: registrar quién subió el archivo
await storage.UploadAsync(new UploadRequest
{
    Path = ruta,
    Content = stream,
    Metadata = new Dictionary<string, string>
    {
        ["creado-por-id"] = usuario.Id.ToString(),
        ["creado-por-nombre"] = usuario.NombreCompleto,
        ["ip-origen"] = httpContext.Connection.RemoteIpAddress?.ToString() ?? "desconocida",
        ["timestamp-utc"] = DateTimeOffset.UtcNow.ToString("O"),
        ["sesion-id"] = httpContext.Session.Id,
        ["origen-app"] = "portal-web"
    }
}, ct);
```

### Flujo de aprobación de documentos

```csharp
public enum EstadoDocumento
{
    Borrador,
    EnRevision,
    Aprobado,
    Rechazado
}

public async Task CambiarEstadoDocumento(
    IStorageProvider storage,
    string ruta,
    EstadoDocumento nuevoEstado,
    string revisorId,
    string? comentario,
    CancellationToken ct)
{
    var meta = await storage.GetMetadataAsync(ruta, ct);
    if (!meta.IsSuccess) return;

    var metadatos = meta.Value!.CustomMetadata
        .ToDictionary(kv => kv.Key, kv => kv.Value);

    metadatos["estado"] = nuevoEstado.ToString();
    metadatos["revisor-id"] = revisorId;
    metadatos["fecha-revision"] = DateTimeOffset.UtcNow.ToString("O");
    if (comentario is not null)
        metadatos["comentario-revision"] = comentario;

    await storage.SetMetadataAsync(ruta, metadatos, ct);
}
```

### Versionado de archivos

```csharp
// Al crear una nueva versión, actualizar los metadatos de la anterior
await storage.SetMetadataAsync(rutaVersionAnterior, new Dictionary<string, string>
{
    ["version-numero"] = "2",
    ["version-siguiente"] = rutaNuevaVersion,
    ["archivado-en"] = DateTimeOffset.UtcNow.ToString("O"),
    ["archivado-por"] = usuarioId
}, ct);

// Al subir la nueva versión
await storage.UploadAsync(new UploadRequest
{
    Path = rutaNuevaVersion,
    Content = contenidoNuevoStream,
    Metadata = new Dictionary<string, string>
    {
        ["version-numero"] = "3",
        ["version-anterior"] = rutaVersionAnterior,
        ["motivo-cambio"] = "Actualización de cláusulas 5 y 7"
    }
}, ct);
```

### Verificar tipo de contenido antes de procesar

```csharp
public async Task<bool> EsImagenValida(
    IStorageProvider storage,
    string ruta,
    CancellationToken ct)
{
    var meta = await storage.GetMetadataAsync(ruta, ct);
    if (!meta.IsSuccess) return false;

    var tiposPermitidos = new HashSet<string>
    {
        "image/jpeg", "image/png", "image/webp", "image/avif"
    };

    return meta.Value!.ContentType is not null
        && tiposPermitidos.Contains(meta.Value.ContentType);
}
```

:::tip Consejo
Usa prefijos coherentes en las claves de metadatos para evitar colisiones con claves del sistema. Por ejemplo, usa un prefijo específico de tu aplicación como `app-`: `app-cliente-id`, `app-estado`, `app-version`. Las claves que comienzan con `x-vali-` están reservadas para uso interno de ValiBlob.
:::
