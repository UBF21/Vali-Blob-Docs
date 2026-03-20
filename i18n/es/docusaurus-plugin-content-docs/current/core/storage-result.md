---
title: StorageResult
sidebar_label: StorageResult
---

# StorageResult

`StorageResult<T>` es el tipo de retorno universal de todas las operaciones de ValiBlob. En lugar de lanzar excepciones, cada operación devuelve un resultado que puede ser exitoso o fallido, con información completa sobre el error cuando ocurre. Este enfoque hace que el manejo de errores sea explícito y predecible.

## Estructura

```csharp
public sealed class StorageResult<T>
{
    public bool IsSuccess { get; }
    public T? Value { get; }
    public StorageErrorCode? ErrorCode { get; }
    public string? ErrorMessage { get; }
    public Exception? Exception { get; }

    public static StorageResult<T> Success(T value);
    public static StorageResult<T> Failure(
        StorageErrorCode code,
        string? message = null,
        Exception? ex = null);
}

// Versión sin tipo genérico para operaciones como Delete, Copy, SetMetadata
public sealed class StorageResult
{
    public bool IsSuccess { get; }
    public StorageErrorCode? ErrorCode { get; }
    public string? ErrorMessage { get; }
    public Exception? Exception { get; }

    public static StorageResult Success();
    public static StorageResult Failure(
        StorageErrorCode code,
        string? message = null,
        Exception? ex = null);
}
```

## Propiedades

| Propiedad | Tipo | Descripción |
|---|---|---|
| `IsSuccess` | `bool` | `true` si la operación fue exitosa |
| `Value` | `T?` | El valor retornado. Solo válido cuando `IsSuccess == true` |
| `ErrorCode` | `StorageErrorCode?` | Código de error estructurado. `null` cuando `IsSuccess == true` |
| `ErrorMessage` | `string?` | Mensaje de error legible para humanos |
| `Exception` | `Exception?` | Excepción original del proveedor si aplica (para diagnóstico) |

:::warning Advertencia
Nunca accedas a `Value` sin verificar `IsSuccess` primero. `Value` es `null` cuando la operación falló.
:::

## Patrón de uso básico

```csharp
var resultado = await storage.UploadAsync(request, ct);

if (resultado.IsSuccess)
{
    Console.WriteLine($"Archivo subido correctamente: {resultado.Value!.Path}");
    Console.WriteLine($"URL de acceso: {resultado.Value.Url}");
}
else
{
    Console.WriteLine($"Error [{resultado.ErrorCode}]: {resultado.ErrorMessage}");
}
```

## Todos los valores de StorageErrorCode

| Código | Descripción | Operaciones típicas |
|---|---|---|
| `NotFound` | El archivo o recurso no existe | Download, Delete, GetMetadata, Copy |
| `FileTooLarge` | El archivo supera el tamaño máximo configurado | Upload |
| `InvalidFileType` | La extensión o tipo MIME no está permitido | Upload |
| `QuotaExceeded` | Se superó la cuota de almacenamiento del usuario o tenant | Upload |
| `DuplicateFile` | El archivo ya existe y la política de conflictos es `Fail` | Upload |
| `VirusDetected` | El análisis antivirus detectó malware en el archivo | Upload |
| `InvalidPath` | La ruta contiene caracteres inválidos o está malformada | Todas |
| `PermissionDenied` | Sin permisos suficientes para ejecutar la operación | Todas |
| `ProviderError` | Error genérico del proveedor de almacenamiento subyacente | Todas |
| `NetworkError` | Error de red o conectividad al proveedor | Todas |
| `Timeout` | La operación superó el tiempo límite configurado | Todas |
| `ConfigurationError` | Error en la configuración del proveedor | Todas |
| `Cancelled` | La operación fue cancelada por el `CancellationToken` | Todas |
| `ValidationError` | Error de validación genérico | Upload |
| `ResumableSessionNotFound` | La sesión de subida reanudable no existe o expiró | Reanudable |
| `ResumableSessionExpired` | La sesión de subida reanudable ha expirado por TTL | Reanudable |
| `InvalidChunkOffset` | El offset del chunk no coincide con el esperado | Reanudable |
| `Unknown` | Error desconocido o no clasificado | Todas |

## Manejo de errores con switch expression

```csharp
var resultado = await storage.UploadAsync(new UploadRequest
{
    Path = "documentos/contrato.pdf",
    Content = pdfStream,
    ContentType = "application/pdf"
}, ct);

IResult respuestaHttp = resultado.ErrorCode switch
{
    null when resultado.IsSuccess =>
        Results.Created($"/archivos/{resultado.Value!.Path}",
            new { ruta = resultado.Value.Path }),

    StorageErrorCode.FileTooLarge =>
        Results.Problem("El archivo supera el tamaño máximo permitido.", statusCode: 413),

    StorageErrorCode.InvalidFileType =>
        Results.Problem("Solo se permiten archivos PDF.", statusCode: 415),

    StorageErrorCode.QuotaExceeded =>
        Results.Problem("Ha superado su cuota de almacenamiento.", statusCode: 507),

    StorageErrorCode.VirusDetected =>
        Results.Problem("El archivo contiene contenido malicioso.", statusCode: 422),

    StorageErrorCode.ProviderError or StorageErrorCode.NetworkError =>
        Results.Problem("Servicio de almacenamiento temporalmente no disponible.", statusCode: 503),

    StorageErrorCode.Cancelled =>
        Results.StatusCode(499),

    _ =>
        Results.Problem($"Error inesperado: {resultado.ErrorMessage}", statusCode: 500)
};

return respuestaHttp;
```

## Operaciones sin valor de retorno

Para operaciones como `DeleteAsync`, `CopyAsync`, `SetMetadataAsync`, el tipo de retorno es `StorageResult` (sin genérico):

```csharp
var resultadoEliminar = await storage.DeleteAsync("archivos/antiguo.pdf", ct);

if (!resultadoEliminar.IsSuccess)
{
    if (resultadoEliminar.ErrorCode == StorageErrorCode.NotFound)
    {
        // El archivo ya no existía — puede ser un comportamiento aceptable
        logger.LogWarning("Se intentó eliminar un archivo inexistente: {Path}", "archivos/antiguo.pdf");
    }
    else
    {
        logger.LogError(
            resultadoEliminar.Exception,
            "No se pudo eliminar el archivo. Código: {Code}",
            resultadoEliminar.ErrorCode);
        throw new InvalidOperationException(
            $"Error al eliminar archivo: {resultadoEliminar.ErrorMessage}");
    }
}
```

## Patrón de extensión: GetValueOrThrow

Si prefieres lanzar una excepción en casos donde el error es verdaderamente inesperado y no recuperable:

```csharp
public static class StorageResultExtensions
{
    public static T GetValueOrThrow<T>(this StorageResult<T> result)
    {
        if (!result.IsSuccess)
        {
            throw new StorageOperationException(
                result.ErrorCode!.Value,
                result.ErrorMessage ?? "La operación de almacenamiento falló.",
                result.Exception);
        }
        return result.Value!;
    }
}

// Uso
var uploadResult = (await storage.UploadAsync(request, ct)).GetValueOrThrow();
Console.WriteLine($"Subido en: {uploadResult.Path}");
```

## Patrón funcional: Map y Bind

ValiBlob incluye métodos de transformación funcional para encadenar operaciones de manera fluida:

```csharp
// Map: transformar el valor si es exitoso, propagar el error si no lo es
StorageResult<string> rutaResult = uploadResult.Map(r => r.Path);

// MapAsync: transformación asíncrona
StorageResult<string> urlResult = await uploadResult
    .MapAsync(async r => await generarUrlFirmadaAsync(r.Path, ct));

// Bind: encadenar operaciones que también retornan StorageResult
StorageResult<FileMetadata> metaResult = await uploadResult
    .BindAsync(async r => await storage.GetMetadataAsync(r.Path, ct));
```

## Integración con logging estructurado

```csharp
public class ServicioDocumentos(IStorageProvider storage, ILogger<ServicioDocumentos> logger)
{
    public async Task<string?> SubirDocumentoAsync(
        Stream contenido,
        string nombre,
        string autorId,
        CancellationToken ct)
    {
        var resultado = await storage.UploadAsync(new UploadRequest
        {
            Path = StoragePath.From("documentos", StoragePath.Sanitize(nombre))
                              .WithTimestampPrefix(),
            Content = contenido,
            Metadata = new Dictionary<string, string>
            {
                ["autor-id"] = autorId,
                ["nombre-original"] = nombre
            }
        }, ct);

        if (resultado.IsSuccess)
        {
            logger.LogInformation(
                "Documento subido. Path={Path} Bytes={Size} Autor={Autor}",
                resultado.Value!.Path,
                resultado.Value.SizeBytes,
                autorId);
            return resultado.Value.Path;
        }

        logger.LogError(
            resultado.Exception,
            "Error al subir documento. Código={Code} Mensaje={Message} Autor={Autor} Archivo={File}",
            resultado.ErrorCode,
            resultado.ErrorMessage,
            autorId,
            nombre);

        return null;
    }
}
```

:::info Información
`StorageResult` está inspirado en el patrón Result/Either de la programación funcional, popularizado por lenguajes como F#, Rust y Haskell. Este enfoque elimina los flujos de control basados en excepciones para errores esperados y hace que el manejo de errores sea explícito y verificable en tiempo de compilación.
:::

:::tip Consejo
Establece una convención en tu equipo: reserva las excepciones para errores verdaderamente inesperados (bugs de programación) y usa `StorageResult` para errores de negocio esperados como archivos demasiado grandes, tipos no permitidos o cuotas superadas. Esto hace que el código sea más fácil de probar y razonar.
:::
