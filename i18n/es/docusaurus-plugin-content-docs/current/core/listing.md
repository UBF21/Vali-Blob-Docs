---
title: Listado de Archivos
sidebar_label: Listado de Archivos
---

# Listado de Archivos

ValiBlob proporciona dos operaciones para explorar el contenido del almacenamiento: `ListFilesAsync` para obtener archivos y `ListFoldersAsync` para obtener prefijos de "carpeta". En almacenamiento en la nube no existen carpetas reales — son convenciones de nomenclatura basadas en prefijos comunes.

## Métodos disponibles

```csharp
// Listar todos los archivos bajo un prefijo dado
Task<StorageResult<IReadOnlyList<FileEntry>>> ListFilesAsync(
    string prefix,
    CancellationToken ct = default);

// Listar prefijos de "carpeta" directamente bajo un prefijo dado
Task<StorageResult<IReadOnlyList<string>>> ListFoldersAsync(
    string prefix,
    CancellationToken ct = default);
```

## FileEntry — estructura

```csharp
public class FileEntry
{
    /// <summary>Ruta completa del archivo.</summary>
    public required string Path { get; init; }

    /// <summary>Nombre del archivo (sin la ruta de directorio).</summary>
    public string FileName => StoragePath.GetFileName(Path);

    /// <summary>Tamaño del archivo en bytes.</summary>
    public long SizeBytes { get; init; }

    /// <summary>Tipo MIME del archivo, si el proveedor lo devuelve.</summary>
    public string? ContentType { get; init; }

    /// <summary>Fecha de última modificación.</summary>
    public DateTimeOffset? LastModified { get; init; }

    /// <summary>ETag del archivo.</summary>
    public string? ETag { get; init; }
}
```

### Campos de FileEntry

| Campo | Tipo | Descripción |
|---|---|---|
| `Path` | `string` | Ruta completa del archivo en el almacenamiento |
| `FileName` | `string` | Solo el nombre del archivo (calculado desde `Path`) |
| `SizeBytes` | `long` | Tamaño del archivo en bytes |
| `ContentType` | `string?` | Tipo MIME (disponibilidad varía por proveedor) |
| `LastModified` | `DateTimeOffset?` | Fecha de última modificación |
| `ETag` | `string?` | Hash de integridad del proveedor |

## ListFilesAsync

### Listar todos los archivos en la raíz

```csharp
// Pasar cadena vacía para listar desde la raíz
var resultado = await storage.ListFilesAsync("", ct);

if (resultado.IsSuccess)
{
    Console.WriteLine($"Total de archivos: {resultado.Value!.Count}");
    foreach (var archivo in resultado.Value!)
    {
        Console.WriteLine($"  {archivo.Path} ({archivo.SizeBytes:N0} bytes)");
    }
}
```

### Listar archivos en una carpeta específica

```csharp
// El prefijo debe terminar en "/" para listar el contenido de una carpeta
var resultado = await storage.ListFilesAsync("documentos/2024/", ct);

if (resultado.IsSuccess)
{
    var archivos = resultado.Value!;
    var totalBytes = archivos.Sum(a => a.SizeBytes);

    Console.WriteLine($"Documentos en 2024: {archivos.Count}");
    Console.WriteLine($"Espacio usado: {totalBytes / 1024.0 / 1024.0:F2} MB");

    foreach (var archivo in archivos.OrderByDescending(a => a.LastModified))
    {
        Console.WriteLine($"  {archivo.FileName,-40} {archivo.LastModified:d} {archivo.SizeBytes / 1024:N0} KB");
    }
}
```

### Listar archivos de un tenant específico

```csharp
public async Task<IReadOnlyList<FileEntry>> ListarArchivosClienteAsync(
    IStorageProvider storage,
    string clienteId,
    string? categoria,
    CancellationToken ct)
{
    var prefijo = categoria is not null
        ? $"tenants/{clienteId}/{categoria}/"
        : $"tenants/{clienteId}/";

    var resultado = await storage.ListFilesAsync(prefijo, ct);
    return resultado.IsSuccess ? resultado.Value! : [];
}
```

### Filtrar por tipo de contenido

```csharp
var resultado = await storage.ListFilesAsync("subidas/", ct);

if (resultado.IsSuccess)
{
    var soloImagenes = resultado.Value!
        .Where(f =>
            f.ContentType?.StartsWith("image/") == true ||
            new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif" }
                .Contains(Path.GetExtension(f.Path).ToLowerInvariant()))
        .OrderBy(f => f.LastModified)
        .ToList();

    Console.WriteLine($"Imágenes encontradas: {soloImagenes.Count}");
}
```

### Calcular uso de almacenamiento

```csharp
public async Task<(long TotalArchivos, long TotalBytes)> CalcularUsoAsync(
    IStorageProvider storage,
    string prefijo,
    CancellationToken ct)
{
    var resultado = await storage.ListFilesAsync(prefijo, ct);
    if (!resultado.IsSuccess) return (0, 0);

    var archivos = resultado.Value!;
    return (archivos.Count, archivos.Sum(a => a.SizeBytes));
}

// Uso
var (total, bytes) = await CalcularUsoAsync(storage, $"tenants/{tenantId}/", ct);
Console.WriteLine($"Uso del tenant: {total} archivos, {bytes / 1024.0 / 1024.0:F2} MB");
```

## ListFoldersAsync

`ListFoldersAsync` retorna los prefijos de "carpeta" directamente bajo el prefijo dado. Cada resultado es una cadena que representa el prefijo de la subcarpeta.

```csharp
// Listar carpetas en la raíz
var resultado = await storage.ListFoldersAsync("", ct);

if (resultado.IsSuccess)
{
    foreach (var carpeta in resultado.Value!)
        Console.WriteLine($"Carpeta: {carpeta}");
    // Ejemplos: "documentos/", "imagenes/", "backups/", "tenants/"
}

// Listar subcarpetas de "tenants/"
var subCarpetas = await storage.ListFoldersAsync("tenants/", ct);
// Ejemplos: ["tenants/acme/", "tenants/globex/", "tenants/initech/"]
```

## Paginación

ValiBlob retorna todos los resultados en una sola llamada, manejando automáticamente la paginación interna de cada proveedor. Para buckets grandes, implementa paginación en la capa de aplicación:

### Paginación por offset

```csharp
public async Task<(IEnumerable<FileEntry> Archivos, int TotalCount)> ListarPaginadoAsync(
    IStorageProvider storage,
    string prefijo,
    int pagina,
    int tamanoPagina,
    CancellationToken ct)
{
    var resultado = await storage.ListFilesAsync(prefijo, ct);
    if (!resultado.IsSuccess) return ([], 0);

    var todos = resultado.Value!.OrderBy(f => f.Path).ToList();
    var paginados = todos
        .Skip(pagina * tamanoPagina)
        .Take(tamanoPagina);

    return (paginados, todos.Count);
}
```

### Paginación eficiente usando prefijos de fecha

```csharp
// Organización recomendada: subidas/AAAA/MM/DD/archivo.ext
// Permite paginar por mes o día sin cargar todos los archivos

public async Task<IReadOnlyList<FileEntry>> ListarPorMesAsync(
    IStorageProvider storage,
    int ano,
    int mes,
    CancellationToken ct)
{
    var prefijo = $"subidas/{ano:D4}/{mes:D2}/";
    var resultado = await storage.ListFilesAsync(prefijo, ct);
    return resultado.IsSuccess ? resultado.Value! : [];
}

public async Task<IReadOnlyList<FileEntry>> ListarPorDiaAsync(
    IStorageProvider storage,
    DateOnly fecha,
    CancellationToken ct)
{
    var prefijo = $"subidas/{fecha:yyyy/MM/dd}/";
    var resultado = await storage.ListFilesAsync(prefijo, ct);
    return resultado.IsSuccess ? resultado.Value! : [];
}
```

### Recorrido recursivo del árbol de carpetas

```csharp
public async Task RecorrerArbolAsync(
    IStorageProvider storage,
    string prefijo,
    Func<FileEntry, Task> procesarArchivo,
    CancellationToken ct,
    int profundidadMaxima = 10,
    int profundidadActual = 0)
{
    if (profundidadActual >= profundidadMaxima) return;

    // Procesar archivos en el nivel actual
    var archivos = await storage.ListFilesAsync(prefijo, ct);
    if (archivos.IsSuccess)
    {
        foreach (var archivo in archivos.Value!)
            await procesarArchivo(archivo);
    }

    // Descender en subcarpetas
    var carpetas = await storage.ListFoldersAsync(prefijo, ct);
    if (carpetas.IsSuccess)
    {
        foreach (var carpeta in carpetas.Value!)
        {
            await RecorrerArbolAsync(storage, carpeta, procesarArchivo, ct,
                profundidadMaxima, profundidadActual + 1);
        }
    }
}
```

## Explorador de archivos como API REST

```csharp
app.MapGet("/api/explorador", async (
    string? prefijo,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var prefijoActual = prefijo ?? "";

    var carpetasTask = storage.ListFoldersAsync(prefijoActual, ct);
    var archivosTask = storage.ListFilesAsync(prefijoActual, ct);
    await Task.WhenAll(carpetasTask, archivosTask);

    var carpetas = carpetasTask.Result.IsSuccess ? carpetasTask.Result.Value! : [];
    var archivos = archivosTask.Result.IsSuccess ? archivosTask.Result.Value! : [];

    return Results.Ok(new
    {
        prefijo = prefijoActual,
        carpetas = carpetas.Select(c => new
        {
            nombre = c.TrimEnd('/').Split('/').Last(),
            ruta = c,
            tipo = "carpeta"
        }),
        archivos = archivos.Select(f => new
        {
            nombre = f.FileName,
            ruta = f.Path,
            tamanoBytes = f.SizeBytes,
            tamanoMb = Math.Round(f.SizeBytes / 1024.0 / 1024.0, 3),
            tipoContenido = f.ContentType,
            ultimaModificacion = f.LastModified
        }),
        totalArchivos = archivos.Count,
        totalBytes = archivos.Sum(f => f.SizeBytes)
    });
});
```

## Consideraciones de rendimiento por proveedor

| Proveedor | Límite interno por solicitud | Paginación automática en ValiBlob |
|---|---|---|
| Amazon S3 | 1,000 objetos | Sí |
| Azure Blob Storage | 5,000 blobs | Sí |
| Google Cloud Storage | 1,000 objetos | Sí |
| OCI Object Storage | 1,000 objetos | Sí |
| Supabase Storage | Variable | Sí |
| Sistema de archivos local | Sin límite | N/A |

:::info Información
ValiBlob gestiona automáticamente la paginación interna de cada proveedor. `ListFilesAsync` devuelve **todos** los resultados independientemente de los límites internos del proveedor, realizando múltiples solicitudes si es necesario. Para buckets con millones de archivos, usa prefijos específicos para limitar el alcance de las consultas.
:::

:::tip Consejo
Adopta desde el inicio una convención de nomenclatura de rutas consistente. El patrón `entidad/{id}/categoria/archivo.ext` o el uso de prefijos de fecha `AAAA/MM/DD/archivo.ext` te permitirá filtrar y listar eficientemente sin necesidad de cargar todos los metadatos del bucket.
:::
