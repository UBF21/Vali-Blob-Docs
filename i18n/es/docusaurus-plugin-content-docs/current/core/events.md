---
title: Eventos de Almacenamiento
sidebar_label: Eventos
---

# Eventos de Almacenamiento

ValiBlob incluye un sistema de eventos que permite reaccionar a operaciones de almacenamiento sin acoplar el código de notificación al código de almacenamiento. Los manejadores de eventos se ejecutan automáticamente después de cada operación.

## Interfaz principal

```csharp
public interface IStorageEventHandler<TEvent> where TEvent : IStorageEvent
{
    Task HandleAsync(TEvent storageEvent, CancellationToken ct = default);
}

public interface IStorageEvent
{
    string EventId { get; }
    DateTimeOffset OccurredAt { get; }
}
```

## Eventos disponibles

| Evento | Cuándo se publica |
|---|---|
| `FileUploadedEvent` | Después de una subida exitosa |
| `FileUploadFailedEvent` | Cuando una subida falla por cualquier motivo |
| `FileDownloadedEvent` | Después de una descarga exitosa |
| `FileDeletedEvent` | Después de eliminar un archivo |
| `FileCopiedEvent` | Después de copiar un archivo |
| `FileMetadataUpdatedEvent` | Después de actualizar metadatos con `SetMetadataAsync` |
| `VirusDetectedEvent` | Cuando el análisis de virus detecta malware |
| `QuotaExceededEvent` | Cuando una subida falla por cuota superada |
| `ResumableUploadCompletedEvent` | Cuando una subida reanudable finaliza correctamente |
| `ResumableUploadAbortedEvent` | Cuando una subida reanudable se aborta |

## Estructura de los eventos

```csharp
// Evento base con campos comunes
public abstract class StorageEventBase : IStorageEvent
{
    public string EventId { get; } = Guid.NewGuid().ToString();
    public DateTimeOffset OccurredAt { get; } = DateTimeOffset.UtcNow;
    public string ProviderName { get; init; } = string.Empty;
}

// Subida exitosa
public class FileUploadedEvent : StorageEventBase
{
    public required string Path { get; init; }
    public required long SizeBytes { get; init; }
    public string? ContentType { get; init; }
    public string? Url { get; init; }
    public bool WasDeduplicated { get; init; }
    public IReadOnlyDictionary<string, string> Metadata { get; init; }
        = new Dictionary<string, string>();
}

// Fallo de subida
public class FileUploadFailedEvent : StorageEventBase
{
    public required string AttemptedPath { get; init; }
    public required StorageErrorCode ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }
    public Exception? Exception { get; init; }
}

// Virus detectado
public class VirusDetectedEvent : StorageEventBase
{
    public required string AttemptedPath { get; init; }
    public required string VirusName { get; init; }
    public string? Details { get; init; }
}

// Cuota superada
public class QuotaExceededEvent : StorageEventBase
{
    public required string AttemptedPath { get; init; }
    public required long CurrentUsageBytes { get; init; }
    public required long QuotaLimitBytes { get; init; }
    public required long FileSizeBytes { get; init; }
}
```

## Registro de manejadores

### En Program.cs

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ });

// Registrar manejadores de eventos
builder.Services.AddScoped<IStorageEventHandler<FileUploadedEvent>, AuditarSubidaHandler>();
builder.Services.AddScoped<IStorageEventHandler<FileUploadFailedEvent>, NotificarErrorHandler>();
builder.Services.AddScoped<IStorageEventHandler<VirusDetectedEvent>, AlertarVirusHandler>();
builder.Services.AddScoped<IStorageEventHandler<QuotaExceededEvent>, NotificarCuotaHandler>();
```

## Implementación de manejadores

### Auditoría de subidas

```csharp
public class AuditarSubidaHandler(
    IAuditService auditService,
    ILogger<AuditarSubidaHandler> logger)
    : IStorageEventHandler<FileUploadedEvent>
{
    public async Task HandleAsync(FileUploadedEvent evento, CancellationToken ct)
    {
        logger.LogInformation(
            "Archivo subido. Path={Path} Tamaño={Size}B Proveedor={Provider} Deduplicado={Dedup}",
            evento.Path, evento.SizeBytes, evento.ProviderName, evento.WasDeduplicated);

        await auditService.RegistrarAsync(new RegistroAuditoria
        {
            Accion = "ARCHIVO_SUBIDO",
            Recurso = evento.Path,
            Timestamp = evento.OccurredAt,
            Detalles = new Dictionary<string, object>
            {
                ["tamanoBytes"] = evento.SizeBytes,
                ["tipoContenido"] = evento.ContentType ?? "desconocido",
                ["proveedor"] = evento.ProviderName,
                ["deduplicado"] = evento.WasDeduplicated
            }
        }, ct);
    }
}
```

### Notificación de errores críticos

```csharp
public class NotificarErrorHandler(
    IEmailService email,
    ILogger<NotificarErrorHandler> logger)
    : IStorageEventHandler<FileUploadFailedEvent>
{
    private static readonly HashSet<StorageErrorCode> ErroresCriticos =
    [
        StorageErrorCode.ProviderError,
        StorageErrorCode.NetworkError,
        StorageErrorCode.ConfigurationError
    ];

    public async Task HandleAsync(FileUploadFailedEvent evento, CancellationToken ct)
    {
        // Solo notificar errores de infraestructura, no errores de negocio
        if (!ErroresCriticos.Contains(evento.ErrorCode))
            return;

        logger.LogError(
            evento.Exception,
            "Error crítico de almacenamiento. Path={Path} Código={Code} Mensaje={Mensaje}",
            evento.AttemptedPath, evento.ErrorCode, evento.ErrorMessage);

        await email.EnviarAlertaAsync(
            destinatario: "operaciones@empresa.com",
            asunto: $"[Alerta] Error de almacenamiento: {evento.ErrorCode}",
            cuerpo: $"Ruta: {evento.AttemptedPath}\n" +
                    $"Error: {evento.ErrorCode}\n" +
                    $"Mensaje: {evento.ErrorMessage}\n" +
                    $"Proveedor: {evento.ProviderName}\n" +
                    $"Timestamp: {evento.OccurredAt:R}",
            ct);
    }
}
```

### Alerta de seguridad por virus

```csharp
public class AlertarVirusHandler(
    IAlertService alertas,
    IRegistroSeguridad registroSeg)
    : IStorageEventHandler<VirusDetectedEvent>
{
    public async Task HandleAsync(VirusDetectedEvent evento, CancellationToken ct)
    {
        await registroSeg.RegistrarAmenazaAsync(new AmenazaSeguridad
        {
            Tipo = TipoAmenaza.Malware,
            ArchivoAfectado = evento.AttemptedPath,
            NombreAmenaza = evento.VirusName,
            Detalles = evento.Details,
            Timestamp = evento.OccurredAt,
            Proveedor = evento.ProviderName
        }, ct);

        await alertas.EnviarAlertaCriticaAsync(
            $"Malware bloqueado: {evento.VirusName} en intento de subida a {evento.AttemptedPath}",
            nivel: NivelAlerta.Critico,
            ct);
    }
}
```

### Notificación de cuota superada

```csharp
public class NotificarCuotaHandler(INotificacionService notificaciones)
    : IStorageEventHandler<QuotaExceededEvent>
{
    public async Task HandleAsync(QuotaExceededEvent evento, CancellationToken ct)
    {
        var porcentajeUso = (double)evento.CurrentUsageBytes / evento.QuotaLimitBytes * 100;
        var usadoMb = evento.CurrentUsageBytes / 1024.0 / 1024.0;
        var limiteMb = evento.QuotaLimitBytes / 1024.0 / 1024.0;

        await notificaciones.EnviarAsync(new Notificacion
        {
            Tipo = TipoNotificacion.Advertencia,
            Titulo = "Cuota de almacenamiento superada",
            Mensaje = $"Uso actual: {usadoMb:F0} MB de {limiteMb:F0} MB ({porcentajeUso:F1}%). " +
                      $"No se pudo subir el archivo solicitado.",
            Proveedor = evento.ProviderName
        }, ct);
    }
}
```

## Múltiples manejadores para el mismo evento

Puedes registrar varios manejadores para el mismo tipo de evento. Se ejecutan en el orden de registro:

```csharp
// Los tres manejadores se ejecutan cada vez que se sube un archivo exitosamente
builder.Services.AddScoped<IStorageEventHandler<FileUploadedEvent>, AuditarSubidaHandler>();
builder.Services.AddScoped<IStorageEventHandler<FileUploadedEvent>, IndexarEnBuscadorHandler>();
builder.Services.AddScoped<IStorageEventHandler<FileUploadedEvent>, EnviarWebhookHandler>();
```

```csharp
// Indexar en motor de búsqueda
public class IndexarEnBuscadorHandler(IBuscadorService buscador)
    : IStorageEventHandler<FileUploadedEvent>
{
    public async Task HandleAsync(FileUploadedEvent evento, CancellationToken ct)
    {
        await buscador.IndexarDocumentoAsync(new DocumentoIndexado
        {
            Id = evento.Path,
            TipoContenido = evento.ContentType,
            TamanoBytes = evento.SizeBytes,
            FechaSubida = evento.OccurredAt,
            Metadatos = evento.Metadata
        }, ct);
    }
}
```

## Manejador genérico para todos los eventos

```csharp
// Registrar logging para cualquier evento de almacenamiento
public class LoggingEventHandler(ILogger<LoggingEventHandler> logger)
    : IStorageEventHandler<IStorageEvent>
{
    public Task HandleAsync(IStorageEvent evento, CancellationToken ct)
    {
        var proveedor = evento is StorageEventBase base_ ? base_.ProviderName : "desconocido";

        logger.LogDebug(
            "Evento de almacenamiento: {TipoEvento} en {Timestamp} por proveedor {Proveedor}",
            evento.GetType().Name,
            evento.OccurredAt,
            proveedor);

        return Task.CompletedTask;
    }
}

// Registro
builder.Services.AddScoped<IStorageEventHandler<IStorageEvent>, LoggingEventHandler>();
```

:::info Información
Los manejadores de eventos se ejecutan en el mismo contexto de la operación que los desencadenó. Si un manejador lanza una excepción, ValiBlob la captura, la registra como advertencia y continúa ejecutando los demás manejadores. Las excepciones en manejadores de eventos **no afectan** el resultado de la operación de almacenamiento original.
:::

:::tip Consejo
Para operaciones costosas en manejadores de eventos (como enviar emails, llamar a APIs externas o procesar imágenes), encola el trabajo en un sistema de colas como Hangfire, MassTransit o Azure Service Bus. Esto evita que la latencia de la notificación afecte el tiempo de respuesta de la subida.
:::
